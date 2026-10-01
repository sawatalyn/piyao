// ============================================================================
// 辨妄阁 · 一键安装器（BianwangInstaller.exe）
//
// 形态：一个程序，四段——自检 / 安装 / 自启选择 / 维护。
//       它不重写安装逻辑，而是调用包内那几个已经实测过的 .cmd 引擎
//       （env / deploy / autostart / run-site / uninstall），把它们的退出码与
//       输出接回来显示。逻辑只有一份，界面只是前置。
//
// 为什么还是 WinForms + 自带 csc：同 Dashboard.cs——不新增 npm 依赖、不动许可
//   台账，Electron 会带来 100MB 量级的新依赖。编译见 installer\build.cmd。
//
// 三条不可让的口径：
//   1) 自检里"依赖在不在"必须是**真跑一次 import**，不能只看 node_modules 目录
//      存在（A-11 的教训：v1.0.0 的包就是这么带着缺失的 ip-address 发出去的）；
//      并且探针要跑在 api\ 里，因为 ESM 裸模块名按发起 import 的文件位置上溯。
//   2) 自启三选一各自对应一个**真实可用**的机制，不发明第三种：
//        不注册 / 登录时（HKCU Run，免管理员）/ 开机时（计划任务 SYSTEM，需管理员，
//      客户端 Windows 可能被策略拒绝——那时降级为登录时并明说，不假装成功）。
//      实测：本机非提权连 schtasks /sc onlogon 都被拒，所以登录态一律走 Run 键。
//   3) 判定"建成"要回查，不信退出码 0 本身（A-14：非终止错误 + 空值继续跑）。
//
// 语言级别：csc 4.0.30319 = C# 5，因此不使用字符串插值、?.、=>、nameof。
// 控制台出口：目标是 winexe，双击不闪黑框；--selfcheck 之类脚本用法靠 AttachConsole
//   接回调用者的控制台，并同时落一份带 BOM 的 UTF-8 报告文件（取证不靠猜编码）。
// ============================================================================
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Net.Security;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace Bianwang.Setup
{
    internal enum Verdict
    {
        Info = 0,
        Pass = 1,
        Warn = 2,
        Fail = 3
    }

    internal sealed class Check
    {
        public string Name;
        public Verdict V;
        public string Detail;
        public string Fix;
        public bool Required;          // false = 影响的是附加能力（仪表盘/开机任务）

        public Check(string name, Verdict v, string detail, bool required)
        {
            Name = name;
            V = v;
            Detail = detail;
            Required = required;
        }

        public Check FixWith(string fix)
        {
            Fix = fix;
            return this;
        }
    }

    // 一次运行所需的全部路径与参数，集中一处，免得各段自己拼
    internal sealed class Site
    {
        public string InstallerDir;    // 本 exe 所在的 installer 目录
        public string PkgRoot;         // 部署包根（installer 的上一层）
        public string Target;          // 装到哪里
        public int Port;
        public bool FromPackage;       // 上一层真有 api\src\index.js

        public string TargetApi { get { return Path.Combine(Target, "api"); } }
        public string TargetInstaller { get { return Path.Combine(Target, "installer"); } }
        public string TargetDashExe { get { return Path.Combine(Target, "dashboard", "BianwangDashboard.exe"); } }

        // 装好之后，引擎脚本必须从**目标目录**那份跑：autostart.cmd / run-site.cmd 都把
        // 自己的上一层当站点根，从包里调用就会启动包里那份 api\，口令记录与运行日志
        // 也一并落进包目录（实测在临时包上装完再自启，起的是包、站根仍是空的）。
        public bool Deployed { get { return File.Exists(Path.Combine(Target, "api", "src", "index.js")); } }
        public string EngineDir
        {
            get
            {
                if (Deployed && Directory.Exists(TargetInstaller)) return TargetInstaller;
                return InstallerDir;
            }
        }
        public string PortFile { get { return Path.Combine(EngineDir, "port.txt"); } }

        // 目标目录也要记：命令行是分次敲的，`--install --target D:\Sites\bw` 之后再来一句
        // `--autostart logon` 若不带 --target，会默默指向默认的 C:\Bianwang——装在一处、自启在另一处。
        public string TargetFile { get { return Path.Combine(InstallerDir, "target.txt"); } }

        public static Site Locate(string targetOverride, int portOverride)
        {
            string dir = AppDomain.CurrentDomain.BaseDirectory;
            try { dir = Path.GetFullPath(dir); } catch (Exception) { }

            Site s = new Site();
            s.InstallerDir = dir;
            s.PkgRoot = Path.GetFullPath(Path.Combine(dir, ".."));
            s.FromPackage = File.Exists(Path.Combine(s.PkgRoot, "api", "src", "index.js"));
            // 不是从包里跑（比如直接在源码仓库里编了个 exe）：仍然指向仓库根，
            // 但自检会因此报"这不是部署包"，避免拿源码树当包验收。
            s.Target = targetOverride;
            if (string.IsNullOrEmpty(s.Target)) s.Target = ReadRememberedTarget(s.TargetFile);
            if (string.IsNullOrEmpty(s.Target)) s.Target = @"C:\Bianwang";
            try { s.Target = Path.GetFullPath(s.Target); } catch (Exception) { }
            s.Port = portOverride > 0 ? portOverride : 0;
            return s;
        }

        static string ReadRememberedTarget(string file)
        {
            try
            {
                if (!File.Exists(file)) return string.Empty;
                return File.ReadAllText(file).Trim();
            }
            catch (Exception) { return string.Empty; }
        }

        /// <summary>装成一次就把落点记下来，后续动词不必重复 --target（记不上不影响本次结果）。</summary>
        public void RememberTarget()
        {
            try
            {
                File.WriteAllText(TargetFile, Target + Environment.NewLine, new UTF8Encoding(false));
            }
            catch (Exception) { }
        }

        // 端口与协议同源：命令行 > installer\port.txt > 仪表盘记的 dashboard.cfg > 空（让人填）。
        // 协议只在这里"跟随"，不在安装器上改：它由仪表盘的「访问协议」那一栏决定并写进 cfg，
        // 默认 http（生产暂无证书就是走这一档）。安装器读出来用于：访问地址、实访探针、自检结论。
        public string Scheme = "http";
        public string TlsFrom = "node";
        public string TlsPfx = "";

        public string SiteUrl(int port)
        {
            if (Scheme != "https") return "http://127.0.0.1:" + port + "/";
            // 前置 Nginx 终结：对外是 443，不带后端端口
            if (TlsFrom == "nginx") return "https://127.0.0.1/";
            return "https://127.0.0.1:" + port + "/";
        }

        public string BaseUrl { get { return SiteUrl(Port).TrimEnd('/'); } }
        public string MenuUrl { get { return BaseUrl + "/api/menu"; } }

        bool portResolved;

        public void ResolvePort()
        {
            if (portResolved) return;
            portResolved = true;
            try
            {
                if (File.Exists(PortFile))
                {
                    int p;
                    if (int.TryParse(File.ReadAllText(PortFile).Trim(), NumberStyles.Integer,
                            CultureInfo.InvariantCulture, out p) && p > 0 && p <= 65535)
                    {
                        Port = p;
                    }
                }
                string cfg = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "Bianwang", "dashboard.cfg");
                if (!File.Exists(cfg)) return;
                string[] lines = File.ReadAllLines(cfg);
                for (int i = 0; i < lines.Length; i++)
                {
                    int eq = lines[i].IndexOf('=');
                    if (eq <= 0) continue;
                    string key = lines[i].Substring(0, eq).Trim().ToLowerInvariant();
                    string val = lines[i].Substring(eq + 1).Trim();
                    if (key == "port" && Port <= 0)
                    {
                        int p;
                        if (int.TryParse(val, NumberStyles.Integer, CultureInfo.InvariantCulture, out p)
                            && p > 0 && p <= 65535) Port = p;
                    }
                    else if (key == "scheme" && val.Length > 0) Scheme = val == "https" ? "https" : "http";
                    else if (key == "tls_from" && val.Length > 0) TlsFrom = val == "nginx" ? "nginx" : "node";
                    else if (key == "tls_pfx" && val.Length > 0) TlsPfx = val;
                }
            }
            catch (Exception) { }
        }
    }

    internal static class Sys
    {
        [DllImport("kernel32.dll")]
        private static extern bool AttachConsole(int dwProcessId);
        private const int ATTACH_PARENT_PROCESS = -1;
        private static bool consoleAttached;

        // winexe 默认没有控制台；脚本调用时把父控制台接回来，输出才看得见
        public static void EnsureConsole()
        {
            if (consoleAttached) return;
            consoleAttached = AttachConsole(ATTACH_PARENT_PROCESS);
        }

        public static bool IsAdmin
        {
            get
            {
                try
                {
                    WindowsIdentity id = WindowsIdentity.GetCurrent();
                    return new WindowsPrincipal(id).IsInRole(WindowsBuiltInRole.Administrator);
                }
                catch (Exception) { return false; }
            }
        }

        public static string FindCsc()
        {
            string[] seeds = new string[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows),
                    @"Microsoft.NET\Framework64\v4.0.30319\csc.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows),
                    @"Microsoft.NET\Framework\v4.0.30319\csc.exe")
            };
            for (int i = 0; i < seeds.Length; i++)
                if (File.Exists(seeds[i])) return seeds[i];
            return null;
        }

        /// <summary>文件的 sha256（小写十六进制）；读不动返回空串，由调用方决定怎么说。</summary>
        public static string Sha256File(string path)
        {
            try
            {
                using (FileStream fs = File.OpenRead(path))
                using (SHA256 sha = SHA256.Create())
                {
                    byte[] hash = sha.ComputeHash(fs);
                    System.Text.StringBuilder sb = new System.Text.StringBuilder(hash.Length * 2);
                    for (int i = 0; i < hash.Length; i++) sb.Append(hash[i].ToString("x2"));
                    return sb.ToString();
                }
            }
            catch (Exception) { return string.Empty; }
        }

        public static Version NodeVersion()
        {
            string o = RunCapture("node.exe", "-v");
            if (o == null) return null;
            o = o.Trim();
            if (o.StartsWith("v")) o = o.Substring(1);
            Version v;
            return Version.TryParse(o, out v) ? v : null;
        }

        // 祖先链上有没有 node_modules：有，则"依赖解析通过"这条不代表包自足（F-18）。
        // 从**上一层**开始找：本层 api\node_modules 正是被测对象，把它算进"祖先"会
        // 让每一个健康目录都自证不健康（实测在解开的包上误报过一次）。
        public static string NearestAncestorNodeModules(string dir)
        {
            try
            {
                DirectoryInfo d = new DirectoryInfo(dir);
                if (d == null) return null;
                d = d.Parent;
                while (d != null)
                {
                    foreach (FileSystemInfo child in d.GetFileSystemInfos("node_modules"))
                        if (child is DirectoryInfo) return child.FullName;
                    d = d.Parent;
                }
            }
            catch (Exception) { }
            return null;
        }

        // 端口能不能bind：true = 被占着（bind 失败），false = 空闲
        public static bool PortBusy(int port)
        {
            try
            {
                TcpListener l = new TcpListener(IPAddress.Loopback, port);
                try { l.Start(); return false; }
                catch (SocketException) { return true; }
                finally { try { l.Stop(); } catch (Exception) { } }
            }
            catch (Exception) { return true; }
        }

        public static string RunCapture(string exe, string args)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(exe, args);
                psi.UseShellExecute = false;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                psi.CreateNoWindow = true;
                using (Process p = Process.Start(psi))
                {
                    string so = p.StandardOutput.ReadToEnd();
                    p.StandardError.ReadToEnd();
                    if (!p.WaitForExit(30000)) { try { p.Kill(); } catch (Exception) { } }
                    return so == null ? string.Empty : so.Trim();
                }
            }
            catch (Exception) { return null; }
        }

        public static string TaskState(string taskName)
        {
            string o = RunCapture("schtasks.exe", "/query /tn \"" + taskName + "\" /fo LIST");
            if (o == null) return "unknown";
            // /query 失败时 cmd 会把错误写进 stderr，这里只可能拿到正文；空 = 没这个任务
            if (o.IndexOf("Task Name", StringComparison.OrdinalIgnoreCase) < 0 &&
                o.IndexOf("任务名", StringComparison.OrdinalIgnoreCase) < 0) return "absent";
            return "present";
        }

        public static string RunKeyValue()
        {
            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(
                    "Software\\Microsoft\\Windows\\CurrentVersion\\Run", false))
                {
                    if (k == null) return null;
                    object o = k.GetValue("BianwangDashboard");
                    return o == null ? null : o.ToString();
                }
            }
            catch (Exception) { return null; }
        }

        public static bool WriteRunValue(string data)
        {
            try
            {
                using (RegistryKey k = Registry.CurrentUser.CreateSubKey(
                    "Software\\Microsoft\\Windows\\CurrentVersion\\Run"))
                {
                    if (k == null) return false;
                    k.SetValue("BianwangDashboard", data, RegistryValueKind.String);
                    return true;
                }
            }
            catch (Exception) { return false; }
        }

        public static void DeleteRunValue()
        {
            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(
                    "Software\\Microsoft\\Windows\\CurrentVersion\\Run", true))
                {
                    if (k != null && k.GetValue("BianwangDashboard") != null) k.DeleteValue("BianwangDashboard");
                }
            }
            catch (Exception) { }
        }

        public static string CredentialNotePath(string siteRoot)
        {
            // 文件名是中文，按码点拼：批处理里的中文字面量会被 OEM 代码页改成乱码（同 creds.ps1）
            string name = new string(new char[] { (char)0x53E3, (char)0x4EE4 }) + ".txt";
            string p = Path.Combine(siteRoot, name);
            return File.Exists(p) ? p : null;
        }

        /// <summary>
        /// 探一次本机站点。**只有回环地址**才接受自签证书：这台机器上"证书是否公网可信"
        /// 不是安装器能判的事，判错会把活站报成死站；同时 Node 20+ 只接受 TLS 1.2，
        /// 而 .NET 4.x 的默认协议表里没有它，所以这里显式打开——两件事都不做，探针会在
        //  站点完全健康的情况下返回"无应答"。
        /// </summary>
        static bool tlsPrepared;

        static void PrepareTls()
        {
            if (tlsPrepared) return;
            tlsPrepared = true;
            try
            {
                // 3072 = Tls12、768 = Tls11：写数值是为了在只装了 4.0 的机器上也能编译运行
                ServicePointManager.SecurityProtocol =
                    (SecurityProtocolType)(3072 | 768 | (int)SecurityProtocolType.Tls);
                ServicePointManager.ServerCertificateValidationCallback = delegate(
                    object sender, X509Certificate certificate, X509Chain chain, SslPolicyErrors errors)
                {
                    if (errors == SslPolicyErrors.None) return true;
                    try
                    {
                        string host = ((HttpWebRequest)sender).Address.Host;
                        return host == "127.0.0.1" || host == "::1"
                            || string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase);
                    }
                    catch (Exception) { return false; }
                };
            }
            catch (Exception) { }
        }

        public static string HttpProbe(string url, int timeoutMs, out string body)
        {
            body = string.Empty;
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
                if (url.StartsWith("https", StringComparison.OrdinalIgnoreCase)) PrepareTls();
                req.UserAgent = "Mozilla/5.0 (bianwang-installer)";
                req.Timeout = timeoutMs;
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                using (Stream st = res.GetResponseStream())
                {
                    if (st != null)
                    {
                        using (StreamReader r = new StreamReader(st, Encoding.UTF8))
                            body = r.ReadToEnd();
                    }
                    return ((int)res.StatusCode).ToString(CultureInfo.InvariantCulture);
                }
            }
            catch (WebException ex)
            {
                if (ex.Response != null)
                {
                    try { return ((int)((HttpWebResponse)ex.Response).StatusCode).ToString(CultureInfo.InvariantCulture); }
                    catch (Exception) { }
                }
                return null;
            }
            catch (Exception) { return null; }
        }
    }

    // 调用包内那几个 .cmd 引擎：逻辑一份，界面只是前置
    internal static class Engine
    {
        static int lastPid;
        public static int LastPid { get { return lastPid; } }

        public static int Run(Site site, string script, string args, Action<string> onLine)
        {
            string ignored;
            return Run(site, script, args, onLine, out ignored);
        }

        // 引擎脚本可能落在 %LOCALAPPDATA% 之类，但都在 installer\ 里；
        // 引擎自身是纯 ASCII（批处理硬闸校验过），所以按默认编码读不会乱。
        public static int Run(Site site, string script, string args, Action<string> onLine, out string output)
        {
            output = string.Empty;
            // deploy.cmd / env.cmd 的"包根"是**它们的上一层**，所以必须始终从包那份调用；
            // 一旦跟着 EngineDir 走到目标目录，deploy 就会把目标当包、判成"自己拷自己"而拒跑
            // （实测：第二次点安装时目标里的脚本停在旧版，更新被 rc 6 挡下）。
            bool fromPackage = string.Equals(script, "deploy.cmd", StringComparison.OrdinalIgnoreCase)
                || string.Equals(script, "env.cmd", StringComparison.OrdinalIgnoreCase);
            string dir = fromPackage ? site.InstallerDir : site.EngineDir;
            string path = Path.Combine(dir, script);
            if (!File.Exists(path))
            {
                // 已部署却没有目标那份：说明 deploy 只拷了一半，明确报出来而不是回退到包
                if (!fromPackage && site.Deployed)
                {
                    if (onLine != null) onLine("[X] 目标目录里没有 " + script + "（" + site.TargetInstaller + "）——"
                        + "部署不完整，请重跑安装段");
                    return 90;
                }
                path = Path.Combine(site.InstallerDir, script);
                if (!File.Exists(path))
                {
                    if (onLine != null) onLine("[X] 引擎脚本不在：" + path);
                    return 90;
                }
            }

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = "cmd.exe";
            // /s 让 cmd 剥掉最外层那对引号，剩下的就是 "脚本路径" 参数1 参数2 ——
            // 路径与目标目录都可能带空格，这是唯一两侧都站得住的写法
            psi.Arguments = "/d /s /c \"\"" + path + "\""
                + (string.IsNullOrEmpty(args) ? string.Empty : " " + args) + "\"";
            psi.WorkingDirectory = Path.GetDirectoryName(path);
            psi.UseShellExecute = false;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.RedirectStandardInput = true;
            psi.CreateNoWindow = true;

            StringBuilder all = new StringBuilder();
            try
            {
                using (Process p = Process.Start(psi))
                {
                    lastPid = p.Id;
                    DataReceivedEventHandler handler = delegate (object sender, DataReceivedEventArgs e)
                    {
                        if (e.Data == null) return;
                        lock (all) { all.AppendLine(e.Data); }
                        if (onLine != null) { try { onLine(e.Data); } catch (Exception) { } }
                    };
                    p.OutputDataReceived += handler;
                    p.ErrorDataReceived += handler;
                    p.BeginOutputReadLine();
                    p.BeginErrorReadLine();
                    // 引擎里的 pause 走 stdin：立刻关掉等价于 <nul，不会卡住无人值守
                    try { p.StandardInput.Close(); } catch (Exception) { }
                    if (!p.WaitForExit(30 * 60 * 1000))
                    {
                        if (onLine != null) onLine("[X] 超过 30 分钟没结束，已终止进程树。");
                        KillTree(p.Id);
                        lastPid = 0;
                        return 91;
                    }
                    lastPid = 0;
                    return p.ExitCode;
                }
            }
            catch (Exception ex)
            {
                lastPid = 0;
                if (onLine != null) onLine("[X] 起不了 " + script + "：" + ex.Message);
                return 92;
            }
        }

        // 部署时 robocopy 可能慢，界面上要能撤。cmd.exe 下面的 node/robocopy 得连树一起杀。
        public static void KillTree(int pid)
        {
            try { Sys.RunCapture("taskkill.exe", "/f /t /pid " + pid.ToString(CultureInfo.InvariantCulture)); }
            catch (Exception) { }
        }

        // 站点必须**独立会话**起：用 ShellExecute 起 cmd /c run-site.cmd，句柄不会被继承，
        // 所以调用方的管道能正常收到 EOF（实测 start /b 的四种写法都会把管道留住不放，
        // 于是 PowerShell -Wait、cmd 的 | 过滤、CI 步骤全都会被一个跑得很好的站点卡死）。
        public static bool StartDetached(Site site, Action<string> onLine)
        {
            string runSite = Path.Combine(site.EngineDir, "run-site.cmd");
            if (!File.Exists(runSite))
            {
                if (onLine != null) onLine("[X] 没有 " + runSite);
                return false;
            }
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                // 必须显式 cmd /c：直接把 .cmd 交给 ShellExecute 会起一个**没有参数的交互 cmd**，
                // 它打印提示符、不退出，站点根本没被拉起来（实测过）
                psi.FileName = "cmd.exe";
                psi.Arguments = "/d /c \"\"" + runSite + "\" >nul 2>&1\"";
                psi.WorkingDirectory = site.EngineDir;
                psi.UseShellExecute = true;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                Process.Start(psi);
            }
            catch (Exception ex)
            {
                if (onLine != null) onLine("[X] 起站失败：" + ex.Message);
                return false;
            }

            if (onLine != null) onLine("[*] 已在新会话里起站，等它监听 " + site.Port + " …");
            for (int i = 0; i < 20; i++)
            {
                Thread.Sleep(1500);
                string body;
                string code = Sys.HttpProbe(site.MenuUrl, 3000, out body);
                if (code == "200")
                {
                    if (onLine != null) onLine("[ok] site is up on " + site.BaseUrl
                        + "（口令记录由站点自己写在站根）");
                    return true;
                }
            }
            if (onLine != null) onLine("[-] 20 次仍没有应答，看 "
                + Path.Combine(site.EngineDir, "run-site.log") + " 里 node 说了什么");
            return false;
        }

        public static void OpenUrl(string url)
        {
            try { Process.Start(url); } catch (Exception) { }
        }
    }

    internal static class Audit
    {
        static readonly string[] StartupImports = new string[]
        {
            "express", "express-rate-limit", "sanitize-html", "minisearch", "multer",
            "cookie-parser", "csv-parse/sync", "csv-stringify/sync", "diff",
            "@rgrove/parse-xml", "pdfjs-dist/legacy/build/pdf.mjs"
        };

        static readonly string[] Engines = new string[]
        {
            "env.cmd", "deploy.cmd", "autostart.cmd", "run-site.cmd", "uninstall.cmd", "creds.cmd", "creds.ps1"
        };

        public static List<Check> Run(Site site)
        {
            List<Check> list = new List<Check>();
            list.Add(PackageShape(site));
            list.Add(NodePresent(site));
            list.Add(DepsResolve(site));
            list.Add(DashboardSource(site));
            list.Add(Compiler(site));
            list.Add(TargetWritable(site));
            list.Add(PortState(site));
            list.Add(Protocol(site));
            list.Add(Privileges(site));
            list.Add(ExistingInstall(site));
            list.Add(AutostartState(site));
            return list;
        }

        // ---- 包完整性 -------------------------------------------------------
        static Check PackageShape(Site site)
        {
            if (!site.FromPackage)
                return new Check("部署包完整性", Verdict.Fail,
                    site.PkgRoot + " 下没有 api\\src\\index.js——这不是解开的发布包"
                    + "（在源码仓库里直接编 exe 只能做自检，装不出东西）", true)
                    .FixWith("解压 bianwang-" + Version() + "-nginx.zip，再运行包内 installer\\setup.cmd");

            List<string> missing = new List<string>();
            if (!Directory.Exists(Path.Combine(site.PkgRoot, "api", "node_modules"))) missing.Add("api\\node_modules");
            if (!File.Exists(Path.Combine(site.PkgRoot, "web", "dist", "index.html"))) missing.Add("web\\dist\\index.html");
            foreach (string eng in Engines)
                if (!File.Exists(Path.Combine(site.InstallerDir, eng))) missing.Add("installer\\" + eng);

            if (missing.Count > 0)
                return new Check("部署包完整性", Verdict.Fail,
                    "包内缺 " + missing.Count + " 项：" + Join(missing, 4), true)
                    .FixWith("重新下载完整包并整目录解压（别只拷 installer\\）");

            // 包里有 exe 分三种情况，得各自说清——尤其别把"正在跑的自己"算成别人的问题（A-17③ 同族）：
            //   一个都没有          = 零 exe 形态（一切现编）
            //   只有 installer 里那一个 = 含 exe 形态，必须能和随包摘要对上
            //   还有别的            = 可疑，警告
            string bundled = Path.Combine(site.InstallerDir, "BianwangInstaller.exe");
            bool hasBundled = File.Exists(bundled);
            List<string> otherExes = new List<string>();
            try
            {
                foreach (string f in Directory.GetFiles(site.PkgRoot, "*.exe", SearchOption.AllDirectories))
                {
                    if (f.Contains(Path.DirectorySeparatorChar + "node_modules" + Path.DirectorySeparatorChar)) continue;
                    if (hasBundled && string.Equals(f, bundled, StringComparison.OrdinalIgnoreCase)) continue;
                    otherExes.Add(Path.GetFileName(f));
                }
            }
            catch (Exception) { }

            if (otherExes.Count > 0)
                return new Check("部署包完整性", Verdict.Warn,
                    "齐全，但包里还有 " + otherExes.Count + " 个别的 .exe（" + Join(otherExes, 4)
                    + "）——除安装器本身外不预置二进制，仪表盘是目标机现编的", false)
                    .FixWith("删掉这些 exe，或用源码重新出包");

            if (!hasBundled)
                return new Check("部署包完整性", Verdict.Pass,
                    "api / web\\dist / 7 个引擎脚本齐全；包内零 .exe——仪表盘与安装器都在目标机现编", true)
                    .FixWith(null);

            string want = ReadBundledDigest(site);
            string got = Sys.Sha256File(bundled);
            if (want.Length == 0)
                return new Check("部署包完整性", Verdict.Warn,
                    "包内预置了 BianwangInstaller.exe，但 installer\\EXE-SHA256.txt 里没有可比对的摘要，"
                    + "\"包没被动过\"这句话就没有根据", true)
                    .FixWith("用 make-nginx-package.mjs --with-exe 重新出包；或删掉 exe 让 setup.cmd 现编");
            if (!string.Equals(want, got, StringComparison.OrdinalIgnoreCase))
                return new Check("部署包完整性", Verdict.Fail,
                    "预置的 BianwangInstaller.exe 与随包摘要不一致（随包 " + Head(want)
                    + " / 实际 " + (got.Length == 0 ? "读不出来" : Head(got)) + "）——这个包可能被替换过", true)
                    .FixWith("重新获取官方包；或删掉它再跑 installer\\build.cmd，用同包源码现编一份");
            return new Check("部署包完整性", Verdict.Pass,
                "api / web\\dist / 7 个引擎脚本齐全；预置安装器与随包摘要一致（sha256 " + Head(got)
                + "，未签名），仪表盘仍由目标机现编", true).FixWith(null);
        }

        static string Head(string hex)
        {
            if (string.IsNullOrEmpty(hex)) return "—";
            return hex.Length <= 16 ? hex : hex.Substring(0, 16) + "…";
        }

        static string ReadBundledDigest(Site site)
        {
            try
            {
                string file = Path.Combine(site.InstallerDir, "EXE-SHA256.txt");
                if (!File.Exists(file)) return string.Empty;
                string[] lines = File.ReadAllLines(file);
                for (int i = 0; i < lines.Length; i++)
                {
                    string l = lines[i].Trim();
                    if (!l.StartsWith("sha256=")) continue;
                    return l.Substring(7).Trim().ToLowerInvariant();
                }
            }
            catch (Exception) { }
            return string.Empty;
        }

        // ---- Node ----------------------------------------------------------
        static Check NodePresent(Site site)
        {
            Version v = Sys.NodeVersion();
            if (v == null)
                return new Check("Node.js 运行时", Verdict.Fail,
                    "PATH 上找不到 node，或版本串解析不出来——后端就是 node 进程", true)
                    .FixWith("本程序的安装段可以代为用 winget 安装（勾选后点安装），或去 https://nodejs.org/zh-cn/download");
            int[] min = new int[] { 20, 19, 0 };
            int[] cur = new int[] { v.Major, v.Minor, Math.Max(v.Build, 0) };
            for (int i = 0; i < 3; i++)
            {
                if (cur[i] > min[i]) break;
                if (cur[i] < min[i])
                    return new Check("Node.js 运行时", Verdict.Fail,
                        "v" + v + " 低于要求的 20.19.0", true)
                        .FixWith("升级 Node LTS：安装段勾选 winget 升级，或 https://nodejs.org/zh-cn/download");
            }
            return new Check("Node.js 运行时", Verdict.Pass, "v" + v + "（要求 ≥ 20.19.0）", true);
        }

        // ---- 依赖：真跑一次 import（A-11 的成因就是"只看目录存在"）----------
        static Check DepsResolve(Site site)
        {
            string api = site.FromPackage
                ? Path.Combine(site.PkgRoot, "api")
                : Path.Combine(site.Target, "api");
            if (!Directory.Exists(api))
                return new Check("后端依赖可解析", Verdict.Warn,
                    api + " 还不存在，装完再复测这一项", true)
                    .FixWith("先跑安装段");

            string probe = Path.Combine(api, ".bianwang-deps-probe.mjs");
            StringBuilder sb = new StringBuilder();
            sb.Append("const specs=[");
            for (int i = 0; i < StartupImports.Length; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append('"').Append(StartupImports[i]).Append('"');
            }
            sb.Append("];const bad=[];for(const s of specs){try{await import(s)}catch(e){bad.push(s+' <- '+((e&&e.code)||'ERR'))}}");
            sb.Append("console.log(bad.length?('MISS|'+bad.join(', ')):'OK')");

            string stdout;
            try
            {
                File.WriteAllText(probe, sb.ToString(), new UTF8Encoding(false));
                stdout = Sys.RunCapture("node.exe", "\"" + probe + "\"");
            }
            catch (Exception ex)
            {
                return new Check("后端依赖可解析", Verdict.Fail, "探针写不进去：" + ex.Message, true);
            }
            finally
            {
                try { if (File.Exists(probe)) File.Delete(probe); } catch (Exception) { }
            }

            if (stdout == null)
                return new Check("后端依赖可解析", Verdict.Fail, "node 没能把探针跑起来（没装 Node 或路径不通）", true);
            if (stdout != "OK" && !stdout.StartsWith("MISS|"))
                return new Check("后端依赖可解析", Verdict.Fail,
                    "探针输出不是预期形状：" + Trim(stdout, 160), true)
                    .FixWith("看 api\\src 是否能被 node 直接加载");

            string farm = Sys.NearestAncestorNodeModules(api);
            if (stdout.StartsWith("MISS|"))
            {
                string miss = Trim(stdout.Substring(5), 200);
                return new Check("后端依赖可解析", Verdict.Fail,
                    "启动期 import 有解析不了的包：" + miss, true)
                    .FixWith(site.FromPackage
                        ? "包的 api\\node_modules 不完整——api\\ 要整目录拷（含 node_modules），别只拿 src"
                        : "用出包脚本重打（hoisted 平铺 + 孤立自足性闸会拦住这种包）");
            }
            if (farm != null)
                return new Check("后端依赖可解析", Verdict.Warn,
                    "11 个启动期 import 全部可解析，但祖先链上有 node_modules（" + farm + "），"
                    + "这条通过不足以证明目录自足", true)
                    .FixWith("把 api\\ 拷到祖先无 node_modules 的位置再测（出包闸③就是这么做的）");
            return new Check("后端依赖可解析", Verdict.Pass,
                "11 个启动期 import 逐个真解析通过，且 " + api + " 的祖先链无 node_modules（自足）", true);
        }

        // ---- 仪表盘源码（现编才有 exe）--------------------------------------
        static Check DashboardSource(Site site)
        {
            string cs = Path.Combine(site.PkgRoot, "dashboard", "Dashboard.cs");
            string build = Path.Combine(site.PkgRoot, "dashboard", "build.cmd");
            if (File.Exists(cs) && File.Exists(build))
                return new Check("仪表盘源码", Verdict.Pass,
                    "dashboard\\Dashboard.cs 与 build.cmd 在包内，安装时在本机现编出 BianwangDashboard.exe", false);
            return new Check("仪表盘源码", Verdict.Warn,
                "包内没有仪表盘源码，装完就只有命令行起站（run-site.cmd），没有图形面板", false)
                .FixWith("用完整包；只要命令行也能跑，不影响站点本身");
        }

        static Check Compiler(Site site)
        {
            string csc = Sys.FindCsc();
            if (csc != null) return new Check("C# 编译器（现编 exe 用）", Verdict.Pass, csc, false);
            return new Check("C# 编译器（现编 exe 用）", Verdict.Warn,
                "%WINDIR%\\Microsoft.NET Framework*\\v4.0.30319\\csc.exe 找不到，仪表盘 exe 编不出来", false)
                .FixWith("optionalfeatures.exe 打开 \".NET Framework 4.8 / 4.x Advanced Services\"；"
                    + "站点本身不需要它，用 run-site.cmd 起站即可");
        }

        // ---- 目标目录 ------------------------------------------------------
        static Check TargetWritable(Site site)
        {
            string probeParent = site.Target;
            try
            {
                DirectoryInfo d = new DirectoryInfo(site.Target);
                while (d != null && !d.Exists) d = d.Parent;
                if (d == null) return new Check("目标目录可写", Verdict.Fail, site.Target + " 连祖先都不存在", true);
                probeParent = d.FullName;
            }
            catch (Exception ex)
            {
                return new Check("目标目录可写", Verdict.Fail, "路径判不上：" + ex.Message, true);
            }

            string tmp = Path.Combine(probeParent, ".bianwang-write-probe-" + Guid.NewGuid().ToString("N").Substring(0, 8));
            try
            {
                Directory.CreateDirectory(tmp);
                File.WriteAllText(Path.Combine(tmp, "p.txt"), "x");
                bool ok = File.Exists(Path.Combine(tmp, "p.txt"));
                return ok
                    ? new Check("目标目录可写", Verdict.Pass, site.Target + "（探针建在 " + probeParent + "）", true)
                    : new Check("目标目录可写", Verdict.Fail, "写了却读不回来：" + probeParent, true);
            }
            catch (Exception ex)
            {
                return new Check("目标目录可写", Verdict.Fail, ex.Message + " —— " + probeParent, true)
                    .FixWith("换到你有权写的目录（如 D:\\Sites\\bianwang），或以管理员身份重跑本程序");
            }
            finally
            {
                try { if (Directory.Exists(tmp)) Directory.Delete(tmp, true); } catch (Exception) { }
            }
        }

        static Check PortState(Site site)
        {
            site.ResolvePort();
            if (site.Port <= 0)
                return new Check("端口", Verdict.Warn, "还没有端口记录：安装段里必须自己填一个", true)
                    .FixWith("填一个本机空闲端口，如 8787");

            bool busy = Sys.PortBusy(site.Port);
            string body;
            string code = Sys.HttpProbe(site.MenuUrl, 3000, out body);
            if (!busy)
                return new Check("端口", Verdict.Pass, site.Port + " 空闲（bind 得到）", true);
            if (code != null)
                return new Check("端口", Verdict.Warn,
                    site.Port + " 已被占用，而且答的就是 /api/menu（HTTP " + code + "）——"
                    + "多半是本站的旧实例还在跑，重装会复用它", true)
                    .FixWith("要么直接用着，要么维护段里停掉再装");
            return new Check("端口", Verdict.Warn,
                site.Port + " 被别的程序占着（bind 不上，但又不应答 /api/menu）", true)
                .FixWith("换一个端口，或维护段停掉占用进程");
        }

        /// <summary>
        /// 协议这一项报的是"这台机器上站点将以什么方式被访问"，判据来自仪表盘写下的 dashboard.cfg。
        /// 关键是第三种情形要报红：选了 HTTPS + 本机后端但证书不在，run-site.cmd 会**拒绝起站**，
        /// 那时"起不来"是设计而不是故障，自检必须先把话说在前面。
        /// </summary>
        static Check Protocol(Site site)
        {
            site.ResolvePort();
            if (site.Scheme != "https")
                return new Check("访问协议", Verdict.Info,
                    "明文 HTTP（默认档）：口令与正文在链路上不加密，别把这个端口朝公网开放", false)
                    .FixWith("要加密：在仪表盘的「访问协议」选 HTTPS，再定本机后端持证书或交给前置 Nginx");

            if (site.TlsFrom == "nginx")
                return new Check("访问协议", Verdict.Warn,
                    "HTTPS 由前置 Nginx 终结：后端仍按明文 HTTP 只监听 127.0.0.1:"
                    + (site.Port > 0 ? site.Port.ToString(CultureInfo.InvariantCulture) : "<端口>")
                    + "；443 与证书要自己在 Nginx 配，本程序不校验它", false)
                    .FixWith("参考 nginx\\bianwang.conf（80→443 跳转 + 证书路径 + HSTS）");

            bool has = !string.IsNullOrEmpty(site.TlsPfx) && File.Exists(site.TlsPfx);
            if (!has)
                return new Check("访问协议", Verdict.Fail,
                    "选了 HTTPS + 本机后端持证书，但证书包不存在："
                    + (string.IsNullOrEmpty(site.TlsPfx) ? "（连路径都没记过）" : site.TlsPfx)
                    + "。run-site.cmd 遇到这种配置会拒绝起站——不会悄悄退回明文，那样你以为加密了、其实没有", true)
                    .FixWith("在仪表盘点「生成本机自签证书」（用系统自带 PowerShell），或填已有的 pfx 路径，或改回 HTTP");

            string expiry = "";
            try
            {
                using (X509Certificate2 c = new X509Certificate2(site.TlsPfx, string.Empty))
                    expiry = " · 到期 " + c.GetExpirationDateString();
            }
            catch (Exception) { }
            return new Check("访问协议", Verdict.Pass,
                "node 直接以 TLS 监听（https），证书 " + site.TlsPfx + expiry
                + "；自签会先弹浏览器告警，属预期", true);
        }

        static Check Privileges(Site site)
        {
            if (Sys.IsAdmin)
                return new Check("权限", Verdict.Pass,
                    "已提权：开机自启（计划任务 ONSTART/SYSTEM）有条件试", false)
                    .FixWith("注意：客户端 Windows（实测 Win11 专业版）即便提权，"
                        + "策略仍可能拒绝把任务身份设为 SYSTEM；那时本程序会降级为登录自启并明说");
            return new Check("权限", Verdict.Warn,
                "未提权：登录自启（HKCU Run）照样能成；开机自启需要管理员", false)
                .FixWith("要开机自启就点\"以管理员身份重新打开\"；不装开机自启则无需提权");
        }

        static Check ExistingInstall(Site site)
        {
            bool deployed = File.Exists(Path.Combine(site.Target, "api", "src", "index.js"));
            bool hasData = File.Exists(Path.Combine(site.Target, "api", "data", "posts.json"));
            if (!deployed)
                return new Check("目标现状", Verdict.Info, site.Target + " 是空的——全新安装", false);
            return new Check("目标现状", Verdict.Info,
                site.Target + " 已部署过" + (hasData ? "，且 api\\data 有档案：这次是更新，数据不动" : "，但还没有档案数据"), false);
        }

        static Check AutostartState(Site site)
        {
            string siteTask = Sys.TaskState("BianwangSite");
            string dashTask = Sys.TaskState("BianwangDashboard");
            string run = Sys.RunKeyValue();
            List<string> parts = new List<string>();
            parts.Add("开机任务 BianwangSite：" + Word(siteTask));
            parts.Add("登录任务 BianwangDashboard：" + Word(dashTask));
            parts.Add("HKCU Run：" + (string.IsNullOrEmpty(run) ? "未注册" : "已注册"));
            return new Check("自启现状", Verdict.Info, Join(parts, 4), false)
                .FixWith("自启段可改；改成\"不注册\"会一并撤掉这些");
        }

        // ---- 小工具 --------------------------------------------------------
        static string Word(string s)
        {
            if (s == "present") return "已注册";
            if (s == "absent") return "未注册";
            return "读不准";
        }

        static string Join(List<string> items, int max)
        {
            if (items.Count <= max) return string.Join("； ", items.ToArray());
            List<string> head = items.GetRange(0, max);
            return string.Join("； ", head.ToArray()) + " …（共 " + items.Count + " 项）";
        }

        static string Trim(string s, int max)
        {
            if (string.IsNullOrEmpty(s)) return "(空)";
            s = s.Replace("\r", " ").Replace("\n", " ").Trim();
            return s.Length <= max ? s : s.Substring(0, max) + "…";
        }


        static string Version()
        {
            try
            {
                string pj = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "api", "package.json");
                if (File.Exists(pj))
                {
                    string txt = File.ReadAllText(pj);
                    int i = txt.IndexOf("\"version\"", StringComparison.Ordinal);
                    if (i >= 0)
                    {
                        int q = txt.IndexOf('"', i + 9);
                        int e = txt.IndexOf('"', q + 1);
                        if (q > 0 && e > q) return txt.Substring(q + 1, e - q - 1);
                    }
                }
            }
            catch (Exception) { }
            return "1.1.0";
        }
    }

    // 四个动作全部落在已实测的引擎脚本上；这里只负责给参数、读结果、回查
    internal static class Actions
    {
        public const string AutoNone = "none";
        public const string AutoLogon = "logon";
        public const string AutoBoot = "boot";

        public static int Install(Site site, bool installNode, Action<string> onLine)
        {
            Line(onLine, "==== 1/2 运行环境 ====");
            int rc = Engine.Run(site, "env.cmd", "", onLine);
            if (rc == 2 && installNode)
            {
                Line(onLine, "");
                Line(onLine, "[*] 按勾选，用 winget 安装/升级 Node.js LTS …");
                rc = Engine.Run(site, "env.cmd", "/install", onLine);
            }
            if (rc != 0)
            {
                Line(onLine, "");
                Line(onLine, "[X] 运行环境这一步没过（退出码 " + rc + "），安装停在复制之前。");
                return 10 + rc;
            }

            Line(onLine, "");
            Line(onLine, "==== 2/2 部署到 " + site.Target + " ====");
            rc = Engine.Run(site, "deploy.cmd", "\"" + site.Target + "\"", onLine);
            if (rc != 0)
            {
                Line(onLine, "[X] 部署没完成（退出码 " + rc + "）。上面 deploy.cmd 已说明原因。");
                return 20 + rc;
            }
            Line(onLine, "");
            Line(onLine, "[ok] 程序已就位。下一步：自启段选一种，或维护段直接起站。");
            site.RememberTarget();
            Line(onLine, "[i] 落点已记在 " + site.TargetFile + "（后续动词不必再带 --target；要换地方就显式给一个）");
            return 0;
        }

        // 端口交给 autostart.cmd 记录（它管 port.txt 的格式），起站由本程序另起会话
        public static bool StartOnce(Site site, Action<string> onLine)
        {
            string portArg = "/port " + site.Port.ToString(CultureInfo.InvariantCulture);
            int rc = Engine.Run(site, "autostart.cmd", portArg + " /site:none /dash:off", onLine);
            if (rc != 0)
            {
                Line(onLine, "[X] 端口没能记下（autostart.cmd 退出码 " + rc + "），也没起站。");
                return false;
            }
            return Engine.StartDetached(site, onLine);
        }

        // 返回 0 = 选定模式已生效；4 = 开机模式被策略拒、已降级为登录自启；其余为失败
        public static int ApplyAutostart(Site site, string mode, bool withDashboard, Action<string> onLine)
        {
            if (site.Port <= 0)
            {
                Line(onLine, "[X] 没给端口。自启是要在没人能填端口的时刻起站的，猜一个比不装更糟。");
                return 3;
            }

            string portArg = "/port " + site.Port.ToString(CultureInfo.InvariantCulture);

            if (mode == AutoBoot)
            {
                Line(onLine, "[*] 注册开机自启：计划任务 BianwangSite（ONSTART，身份 SYSTEM）…");
                int rc = Engine.Run(site, "autostart.cmd",
                    portArg + " /site:boot /dash:" + (withDashboard ? "on" : "off"), onLine);
                if (rc == 0)
                {
                    Line(onLine, "[ok] 已注册并回查过：无人登录也能访问 " + site.BaseUrl);
                    return 0;
                }
                if (rc == 4)
                {
                    Line(onLine, "");
                    Line(onLine, "[-] 这台机器不让任务取 SYSTEM 身份（客户端 Windows 的策略常见）。");
                    Line(onLine, "    已自动降级：改用登录自启（HKCU Run，不需要管理员）。");
                    Line(onLine, "    差别：登录前网站不可达；要真正开机可达得换 Windows Server，或");
                    Line(onLine, "    按 docs\\DEPLOY.md 用 nssm/服务方式托管。");
                    int rc2 = RegisterLogon(site, onLine);
                    return rc2 == 0 ? 4 : rc2;
                }
                if (rc == 1)
                {
                    Line(onLine, "[X] 未提权，开机任务建不了。登录自启不需要管理员——要改选它就点下面那条。");
                    return 1;
                }
                Line(onLine, "[X] 注册没完成（退出码 " + rc + "）。");
                return rc;
            }

            if (mode == AutoLogon)
            {
                if (withDashboard) return RegisterLogon(site, onLine);
                Line(onLine, "[X] 只勾了站点没勾仪表盘：登录态起站就是靠仪表盘带起来的"
                    + "（run-site.cmd 挂在 Run 键上会闪一个黑框）。请勾\"随登录起仪表盘\"，或选开机自启。");
                return 5;
            }

            Line(onLine, "[*] 不注册任何自启：撤掉既有任务与 Run 键，站点只现在起一次…");
            // 没有任务就别去 schtasks /delete：那条在无管理员时只会打印一段提权说明，
            // 让人以为出了错（实测 mode=none 的日志被它污染过）
            if (Sys.TaskState("BianwangSite") == "present" || Sys.TaskState("BianwangDashboard") == "present")
                Engine.Run(site, "autostart.cmd", "/remove", onLine);
            else
                Line(onLine, "    计划任务本来就没注册，无需撤。");
            Sys.DeleteRunValue();
            bool up = StartOnce(site, onLine);
            Line(onLine, up
                ? "[ok] 现在起着；因为没注册自启，重启后要在维护段再点一次起站"
                : "[-] 站点这次没能起来，日志见维护段");
            return up ? 0 : 9;
        }

        static int RegisterLogon(Site site, Action<string> onLine)
        {
            string exe = site.TargetDashExe;
            if (!File.Exists(exe))
            {
                Line(onLine, "[X] " + exe + " 不在——登录自启要指向它。先跑安装段（安装时会现编）。");
                return 6;
            }

            Line(onLine, "[*] 注册登录自启：HKCU\\...\\Run = BianwangDashboard");
            if (!Sys.WriteRunValue("\"" + exe + "\" --autostart"))
            {
                Line(onLine, "[X] Run 键写不进去（组策略禁注册表？）。");
                return 7;
            }

            // 判"建成"要回查，不能信写函数返回的 ok（A-14 同一类错）
            string back = Sys.RunKeyValue();
            if (string.IsNullOrEmpty(back) || back.IndexOf("--autostart", StringComparison.Ordinal) < 0)
            {
                Line(onLine, "[X] 写完读回来不对：\"" + Trim(back) + "\"");
                return 8;
            }

            // run-site.cmd 读 installer\port.txt；把端口记下来，登录时才知道起在哪个口
            try
            {
                string dir = site.TargetInstaller;
                if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
                File.WriteAllText(Path.Combine(dir, "port.txt"),
                    site.Port.ToString(CultureInfo.InvariantCulture) + Environment.NewLine,
                    new UTF8Encoding(false));
            }
            catch (Exception ex)
            {
                Line(onLine, "[-] 端口记录没写进去（" + ex.Message + "）；首次登录时请在仪表盘里手填");
            }

            Line(onLine, "[ok] 回查通过：" + Trim(back));
            Line(onLine, "[*] 顺带把站点现在起一次…");
            StartOnce(site, onLine);
            Line(onLine, "    差别：这条只在有人登录之后才起站；登录前不可达。");
            return 0;
        }

        public static int LiveCheck(Site site, Action<string> onLine)
        {
            if (site.Port <= 0) { Line(onLine, "[X] 没有端口记录，无从检查"); return 3; }
            string body;
            string code = Sys.HttpProbe(site.MenuUrl, 8000, out body);
            if (code == null)
            {
                Line(onLine, "[X] " + site.Port + " 上没有应答。日志：" + Path.Combine(site.TargetInstaller, "run-site.log"));
                return 4;
            }
            if (code != "200")
            {
                Line(onLine, "[X] /api/menu 返回 HTTP " + code + "，不是 200");
                return 5;
            }
            int items = body == null ? 0 : body.Split("\"id\"".ToCharArray(), StringSplitOptions.RemoveEmptyEntries).Length - 1;
            Line(onLine, "[ok] 后端活着：/api/menu HTTP 200，菜单条目字段 " + (items < 0 ? 0 : items) + " 个");
            Line(onLine, "     站点 " + site.BaseUrl);
            string creds = Sys.CredentialNotePath(site.Target);
            Line(onLine, creds == null
                ? "     口令记录：还没生成（站点第一次启动才写），装完先起一次站"
                : "     口令记录：" + creds + "（明文，按口令对待）");
            return 0;
        }

        public static int Uninstall(Site site, bool keepFiles, string dataBackup, Action<string> onLine)
        {
            string args = keepFiles ? "/quiet" : "";
            if (!string.IsNullOrEmpty(dataBackup)) args += (args.Length > 0 ? " " : "") + "/data \"" + dataBackup + "\"";
            Line(onLine, "[*] 调 uninstall.cmd " + (args.Length == 0 ? "(交互，会要一个 DELETE)" : args));
            if (!keepFiles)
                Line(onLine, "    注意：uninstall.cmd 的删除部分在 %TEMP% 的副本窗口里跑"
                    + "（批处理读不到自己已删掉的后续行），那个窗口才是回答 DELETE 的地方");
            return Engine.Run(site, "uninstall.cmd", args, onLine);
        }

        static void Line(Action<string> onLine, string s)
        {
            if (onLine != null) { try { onLine(s); } catch (Exception) { } }
        }

        static string Trim(string s)
        {
            if (string.IsNullOrEmpty(s)) return "(空)";
            s = s.Replace("\r", " ").Replace("\n", " ").Trim();
            return s.Length <= 120 ? s : s.Substring(0, 120) + "…";
        }
    }

    internal static class Program
    {
        [STAThread]
        static int Main(string[] args)
        {
            string target = null;
            int port = 0;
            string mode = null;
            string report = null;
            bool withDash = true;
            bool installNode = false;
            string verb = "gui";

            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i].ToLowerInvariant();
                if (a == "--target" && i + 1 < args.Length) target = args[++i];
                else if (a == "--port" && i + 1 < args.Length)
                {
                    int p;
                    if (int.TryParse(args[i + 1], NumberStyles.Integer, CultureInfo.InvariantCulture, out p)) port = p;
                    i++;
                }
                else if (a == "--autostart" && i + 1 < args.Length) mode = args[++i].ToLowerInvariant();
                else if (a == "--report" && i + 1 < args.Length) report = args[++i];
                else if (a == "--no-dashboard") withDash = false;
                else if (a == "--node-install") installNode = true;
                else if (a == "--selfcheck") verb = "selfcheck";
                else if (a == "--ping") verb = "ping";
                else if (a == "--install") verb = "install";
                else if (a == "--status") verb = "status";
                else if (a == "--live") verb = "live";
                else if (a == "--open-creds") verb = "creds";
                else if (a == "--gui") verb = "gui";
            }

            Site site = Site.Locate(target, port);

            // 引导器用它确认"刚编出来的 exe 真能执行"：新写出的 exe 会被实时扫描短暂占用，
            // 头一次启动常报拒绝访问，重试几次比把这个问题推给用户有用
            if (verb == "ping") return 0;

            // 只给了自启模式没给动作 = 就改自启这一件事
            if (verb == "gui" && mode != null) verb = "autostart";

            site.ResolvePort();

            if (verb == "gui")
            {
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new MainForm(site, mode, installNode));
                return 0;
            }

            Sys.EnsureConsole();
            ReportSink sink = new ReportSink(report);
            int rc = 0;
            try
            {
                if (verb == "selfcheck")
                {
                    sink.Line("辨妄阁 一键安装器 · 自检   包根 " + site.PkgRoot);
                    sink.Line("目标 " + site.Target + "   端口 " + (site.Port > 0 ? site.Port.ToString() : "(未记录)")
                        + "   提权 " + (Sys.IsAdmin ? "是" : "否"));
                    sink.Line("");
                    int fails = 0;
                    foreach (Check c in Audit.Run(site))
                    {
                        sink.Line(Badge(c.V) + " " + c.Name + " — " + c.Detail);
                        if (!string.IsNullOrEmpty(c.Fix)) sink.Line("      处理：" + c.Fix);
                        if (c.V == Verdict.Fail && c.Required) fails++;
                    }
                    sink.Line("");
                    sink.Line(fails == 0 ? "结论：可以安装。" : "结论：有 " + fails + " 项必需检查没过，先按上面的处理。");
                    rc = fails == 0 ? 0 : 2;
                }
                else if (verb == "install")
                {
                    sink.Line("辨妄阁 一键安装器 · 安装   -> " + site.Target);
                    rc = Actions.Install(site, installNode, sink.Line);
                    if (rc == 0 && mode != null)
                    {
                        sink.Line("");
                        sink.Line("==== 自启：" + mode + " ====");
                        rc = Actions.ApplyAutostart(site, mode, withDash, sink.Line);
                    }
                }
                else if (verb == "autostart")
                {
                    sink.Line("辨妄阁 一键安装器 · 自启 " + mode + "   目标 " + site.Target
                        + "   端口 " + (site.Port > 0 ? site.Port.ToString(CultureInfo.InvariantCulture) : "(未记录)"));
                    rc = Actions.ApplyAutostart(site, mode, withDash, sink.Line);
                }
                else if (verb == "live")
                {
                    rc = Actions.LiveCheck(site, sink.Line);
                }
                else if (verb == "creds")
                {
                    string p = Sys.CredentialNotePath(site.Target);
                    if (p == null) { sink.Line("[-] 口令记录还没生成：" + site.Target + " 下没有那个文件（站点没起过）"); rc = 2; }
                    else { sink.Line("[ok] " + p); Engine.OpenUrl("notepad.exe"); Engine.OpenUrl(p); }
                }
                else
                {
                    sink.Line("辨妄阁 一键安装器 · 现状   目标 " + site.Target
                        + "   端口 " + (site.Port > 0 ? site.Port.ToString() : "(未记录)")
                        + "   提权 " + (Sys.IsAdmin ? "是" : "否"));
                    foreach (Check c in Audit.Run(site)) sink.Line(Badge(c.V) + " " + c.Name + " — " + c.Detail);
                    rc = 0;
                }
            }
            finally
            {
                sink.Close();
            }
            return rc;
        }

        static string Badge(Verdict v)
        {
            if (v == Verdict.Pass) return "[ok]";
            if (v == Verdict.Warn) return "[-]";
            if (v == Verdict.Fail) return "[X]";
            return "[i]";
        }
    }

    // 脚本用法要把结果落成可回读的文件：带 BOM 的 UTF-8，别让取证去猜控制台编码
    internal sealed class ReportSink
    {
        readonly string path;
        StreamWriter w;

        public ReportSink(string path)
        {
            this.path = path;
            try
            {
                if (!string.IsNullOrEmpty(path))
                {
                    string dir = Path.GetDirectoryName(path);
                    if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir)) Directory.CreateDirectory(dir);
                    w = new StreamWriter(path, false, new UTF8Encoding(true));
                }
            }
            catch (Exception) { w = null; }
        }

        public void Line(string s)
        {
            try { Console.Out.WriteLine(s); } catch (Exception) { }
            if (w != null) { try { w.WriteLine(s); w.Flush(); } catch (Exception) { } }
        }

        public void Close()
        {
            if (w != null) { try { w.Flush(); w.Close(); } catch (Exception) { } w = null; }
        }
    }

    internal sealed class MainForm : Form
    {
        static readonly Color PaperLeaf = Color.FromArgb(0xfb, 0xf8, 0xf1);
        static readonly Color TerraField = Color.FromArgb(0xf6, 0xf2, 0xe8);
        static readonly Color InkSoft = Color.FromArgb(0x3d, 0x3e, 0x3a);
        static readonly Color InkMute = Color.FromArgb(0x6b, 0x6c, 0x66);
        static readonly Color RuleQuiet = Color.FromArgb(0xc3, 0xbc, 0xac);
        static readonly Color Signal = Color.FromArgb(0xb2, 0x3b, 0x2f);
        static readonly Color OkGreen = Color.FromArgb(0x4b, 0x63, 0x45);
        static readonly Color Critical = Color.FromArgb(0x8c, 0x28, 0x25);

        readonly Site site;
        readonly string presetMode;
        readonly bool presetNodeInstall;
        readonly List<Check> lastChecks = new List<Check>();

        ListView checkList;
        Label summaryLabel;
        Button recheckButton;
        Button elevateButton;

        TextBox targetBox;
        TextBox portBox;
        CheckBox nodeInstallCheck;
        Button installButton;
        Button cancelButton;

        RadioButton radioNone;
        RadioButton radioLogon;
        RadioButton radioBoot;
        CheckBox dashCheck;
        Button applyAutoButton;

        Label liveLabel;
        TextBox logBox;

        volatile bool busy;

        public MainForm(Site site, string presetMode, bool presetNodeInstall)
        {
            this.site = site;
            this.presetMode = presetMode;
            this.presetNodeInstall = presetNodeInstall;
            BuildUi();
            RunSelfCheck();
        }

        // ---- 布局 ----------------------------------------------------------
        void BuildUi()
        {
            Text = "辨妄阁 · 一键安装器";
            ClientSize = new Size(940, 700);
            StartPosition = FormStartPosition.CenterScreen;
            MinimumSize = new Size(760, 560);
            BackColor = PaperLeaf;
            Font = new Font("Microsoft YaHei UI", 9F);

            Label head = new Label();
            head.Text = "辨妄阁 辟谣档案 · Windows 一键安装";
            head.SetBounds(16, 12, 600, 24);
            head.Font = new Font("Microsoft YaHei UI", 13F, FontStyle.Bold);
            head.ForeColor = InkSoft;
            Controls.Add(head);

            summaryLabel = new Label();
            summaryLabel.SetBounds(16, 38, 900, 18);
            summaryLabel.ForeColor = InkMute;
            summaryLabel.Text = "包 " + site.PkgRoot;
            Controls.Add(summaryLabel);

            TabControl tabs = new TabControl();
            tabs.SetBounds(12, 62, 916, 430);
            tabs.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Bottom;
            Controls.Add(tabs);

            tabs.TabPages.Add(BuildCheckTab());
            tabs.TabPages.Add(BuildInstallTab());
            tabs.TabPages.Add(BuildAutostartTab());
            tabs.TabPages.Add(BuildMaintainTab());

            Label logTitle = new Label();
            logTitle.Text = "执行日志";
            logTitle.SetBounds(16, 500, 200, 16);
            logTitle.Anchor = AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Bottom;
            logTitle.ForeColor = InkSoft;
            Controls.Add(logTitle);

            cancelButton = new Button();
            cancelButton.Text = "取消当前动作";
            cancelButton.SetBounds(760, 496, 160, 24);
            cancelButton.Anchor = AnchorStyles.Right | AnchorStyles.Bottom;
            cancelButton.Enabled = false;
            cancelButton.Click += delegate { CancelBusy(); };
            Controls.Add(cancelButton);

            logBox = new TextBox();
            logBox.SetBounds(12, 522, 916, 166);
            logBox.Anchor = AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Bottom;
            logBox.Multiline = true;
            logBox.ReadOnly = true;
            logBox.ScrollBars = ScrollBars.Vertical;
            logBox.BackColor = Color.FromArgb(0x2b, 0x2a, 0x26);
            logBox.ForeColor = Color.FromArgb(0xe8, 0xe3, 0xd6);
            logBox.Font = new Font("Consolas", 9F);
            logBox.WordWrap = false;
            Controls.Add(logBox);
        }

        TabPage BuildCheckTab()
        {
            TabPage p = new TabPage("1 自检");
            p.BackColor = PaperLeaf;

            recheckButton = new Button();
            recheckButton.Text = "重新自检";
            recheckButton.SetBounds(12, 8, 110, 28);
            recheckButton.Click += delegate { RunSelfCheck(); };
            p.Controls.Add(recheckButton);

            elevateButton = new Button();
            elevateButton.Text = "以管理员身份重新打开";
            elevateButton.SetBounds(130, 8, 170, 28);
            elevateButton.Visible = !Sys.IsAdmin;
            elevateButton.Click += delegate { RelaunchElevated(); };
            p.Controls.Add(elevateButton);

            Label hint = new Label();
            hint.Text = "缺必需项时安装按钮不会放过：宁可拦住，也不要装出一个跑不起来的站点。";
            hint.SetBounds(312, 12, 590, 20);
            hint.ForeColor = InkMute;
            p.Controls.Add(hint);

            checkList = new ListView();
            checkList.SetBounds(12, 44, 892, 352);
            checkList.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Bottom;
            checkList.View = View.Details;
            checkList.FullRowSelect = true;
            checkList.HideSelection = false;
            checkList.GridLines = true;
            checkList.Columns.Add("结果", 64);
            checkList.Columns.Add("项目", 210);
            checkList.Columns.Add("说明", 600);
            p.Controls.Add(checkList);
            return p;
        }

        TabPage BuildInstallTab()
        {
            TabPage p = new TabPage("2 安装");
            p.BackColor = PaperLeaf;

            Label l1 = new Label();
            l1.Text = "安装到";
            l1.SetBounds(16, 20, 60, 20);
            l1.ForeColor = InkSoft;
            p.Controls.Add(l1);

            targetBox = new TextBox();
            targetBox.SetBounds(78, 18, 620, 24);
            targetBox.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            targetBox.Text = site.Target;
            p.Controls.Add(targetBox);

            Button browse = new Button();
            browse.Text = "浏览…";
            browse.SetBounds(706, 17, 90, 26);
            browse.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            browse.Click += delegate { PickFolder(); };
            p.Controls.Add(browse);

            Label l2 = new Label();
            l2.Text = "端口";
            l2.SetBounds(16, 56, 60, 20);
            l2.ForeColor = InkSoft;
            p.Controls.Add(l2);

            portBox = new TextBox();
            portBox.SetBounds(78, 54, 90, 24);
            portBox.Text = site.Port > 0 ? site.Port.ToString(CultureInfo.InvariantCulture) : "";
            portBox.TextChanged += delegate { UpdateInstallEnabled(); };
            p.Controls.Add(portBox);

            nodeInstallCheck = new CheckBox();
            nodeInstallCheck.Text = "Node 缺失或过旧时，用 winget 代装/升级（要联网，走 127.0.0.1:7897 代理）";
            nodeInstallCheck.SetBounds(190, 55, 620, 22);
            nodeInstallCheck.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            nodeInstallCheck.ForeColor = InkSoft;
            nodeInstallCheck.Checked = presetNodeInstall;
            p.Controls.Add(nodeInstallCheck);

            installButton = new Button();
            installButton.Text = "开始安装";
            installButton.SetBounds(16, 92, 150, 34);
            installButton.Click += delegate { StartInstall(); };
            p.Controls.Add(installButton);

            Label note = new Label();
            note.Text = "已装过再点一次就是更新：\r\napi\\data（档案、上传图片、口令 CSV）与目标里的 口令.txt 都不会被覆盖。";
            note.SetBounds(180, 92, 720, 46);
            note.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            note.ForeColor = InkMute;
            p.Controls.Add(note);

            // 中文长行不会被 GDI 自动折行，超出宽度就是硬裁掉——所以每行自己断开
            Label explain = new Label();
            explain.Text = "这一步做四件事：\r\n"
                + "· 把包里的 api / web / nginx / docs / ops / dashboard / installer 拷到目标目录\r\n"
                + "· robocopy 跳过运行态文件（.secret / sessions.json / security.log / 计数文件）\r\n"
                + "· 目标还没有档案数据时，灌一份出厂演示内容\r\n"
                + "· 用本机 csc 现编 BianwangDashboard.exe；口令记录由后端在站点第一次启动时写到站根";
            explain.SetBounds(16, 150, 890, 110);
            explain.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            explain.ForeColor = InkSoft;
            p.Controls.Add(explain);
            return p;
        }

        TabPage BuildAutostartTab()
        {
            TabPage p = new TabPage("3 自启选择");
            p.BackColor = PaperLeaf;

            radioNone = new RadioButton();
            radioNone.Text = "不注册自启";
            radioNone.SetBounds(18, 16, 300, 22);
            radioNone.ForeColor = InkSoft;
            p.Controls.Add(radioNone);

            radioLogon = new RadioButton();
            radioLogon.Text = "登录后自动起（HKCU Run，不需要管理员）";
            radioLogon.SetBounds(18, 60, 420, 22);
            radioLogon.ForeColor = InkSoft;
            radioLogon.Checked = true;
            p.Controls.Add(radioLogon);

            radioBoot = new RadioButton();
            radioBoot.Text = "开机即起，无人登录也可访问（计划任务 ONSTART / SYSTEM，需管理员）";
            radioBoot.SetBounds(18, 104, 620, 22);
            radioBoot.ForeColor = InkSoft;
            p.Controls.Add(radioBoot);

            dashCheck = new CheckBox();
            dashCheck.Text = "（仅开机自启时可选）另外注册一个登录任务，让桌面仪表盘随登录出现";
            dashCheck.SetBounds(60, 140, 700, 22);
            dashCheck.ForeColor = InkSoft;
            dashCheck.Checked = true;
            dashCheck.Enabled = radioBoot.Checked;
            p.Controls.Add(dashCheck);

            applyAutoButton = new Button();
            applyAutoButton.Text = "应用自启设置";
            applyAutoButton.SetBounds(18, 176, 160, 32);
            applyAutoButton.Click += delegate { StartAutostart(); };
            p.Controls.Add(applyAutoButton);

            Label warn = new Label();
            // 每行自己断开：GDI 不折中文长行，超宽就是硬裁
            warn.Text = "三选一的真实边界，说清楚再点：\r\n"
                + "· 开机即起是唯一\"没人登录也能访问\"的形态，它要任务身份取 SYSTEM。\r\n"
                + "  实测客户端 Windows（Win11 专业版）即便提权，策略仍可能拒绝；\r\n"
                + "  被拒时这里会自动降级成\"登录后自动起\"并在日志里写明，不会假装装好了。\r\n"
                + "· 登录后自动起靠注册表 Run 键，普通用户权限就能成；差别是登录前网站不可达。\r\n"
                + "· 实测本机非提权时 schtasks 连 /sc onlogon 都拒，所以登录态一律走 Run 键。\r\n"
                + "· 内网长期服务请用 Windows Server，或按 docs\\DEPLOY.md 把 node 托管成服务。";
            warn.SetBounds(18, 222, 886, 160);
            warn.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            warn.ForeColor = InkMute;
            p.Controls.Add(warn);

            if (!string.IsNullOrEmpty(presetMode))
            {
                if (presetMode == Actions.AutoNone) radioNone.Checked = true;
                else if (presetMode == Actions.AutoBoot) radioBoot.Checked = true;
                else radioLogon.Checked = true;
            }
            radioBoot.CheckedChanged += delegate { dashCheck.Enabled = radioBoot.Checked; };
            dashCheck.Enabled = radioBoot.Checked;
            return p;
        }

        TabPage BuildMaintainTab()
        {
            TabPage p = new TabPage("4 维护");
            p.BackColor = PaperLeaf;

            liveLabel = new Label();
            liveLabel.SetBounds(16, 14, 890, 40);
            liveLabel.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            liveLabel.ForeColor = InkSoft;
            liveLabel.Text = "还没检查。";
            p.Controls.Add(liveLabel);

            Button b1 = PushButton(p, "打开站点", 16, 62, delegate { OpenSite(); });
            Button b2 = PushButton(p, "实活检查 /api/menu", 160, 62, delegate { StartLiveCheck(); });
            Button b3 = PushButton(p, "起站点（现在）", 350, 62, delegate { StartSiteNow(); });
            Button b4 = PushButton(p, "停站点", 500, 62, delegate { StopSiteNow(); });
            Button b5 = PushButton(p, "打开口令记录", 610, 62, delegate { OpenCreds(); });
            Button b6 = PushButton(p, "打开仪表盘", 740, 62, delegate { OpenDashboard(); });

            b1.Width = 130; b2.Width = 180; b3.Width = 140; b4.Width = 100;
            b5.Width = 120; b6.Width = 130;
            b6.SetBounds(740, 62, 140, 30);

            Label danger = new Label();
            danger.Text = "卸载";
            danger.SetBounds(16, 116, 200, 20);
            danger.ForeColor = Signal;
            danger.Font = new Font("Microsoft YaHei UI", 10F, FontStyle.Bold);
            p.Controls.Add(danger);

            Button u1 = PushButton(p, "只停服务与自启（留文件）", 16, 142, delegate { StartUninstall(true); });
            u1.Width = 240;
            Button u2 = PushButton(p, "彻底卸载（连 api\\data 一起删）", 270, 142, delegate { StartUninstall(false); });
            u2.Width = 240;
            u2.ForeColor = Critical;

            Label u3 = new Label();
            u3.Text = "彻底卸载要在弹出的小窗口里输入 DELETE 才动手；先备份档案数据，请把目标目录里的 api\\data 另拷一份。";
            u3.SetBounds(16, 184, 880, 40);
            u3.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            u3.ForeColor = InkMute;
            p.Controls.Add(u3);
            return p;
        }

        static Button PushButton(TabPage p, string text, int x, int y, EventHandler onClick)
        {
            Button b = new Button();
            b.Text = text;
            b.SetBounds(x, y, 130, 30);
            b.ForeColor = InkSoft;
            b.Click += onClick;
            p.Controls.Add(b);
            return b;
        }

        // ---- 自检 ----------------------------------------------------------
        void RunSelfCheck()
        {
            site.Target = SafeFull(targetBox != null ? targetBox.Text : site.Target);
            int p;
            if (portBox != null && int.TryParse(portBox.Text.Trim(), NumberStyles.Integer,
                    CultureInfo.InvariantCulture, out p) && p > 0 && p <= 65535) site.Port = p;
            site.ResolvePort();

            List<Check> items = Audit.Run(site);
            lastChecks.Clear();
            checkList.BeginUpdate();
            checkList.Items.Clear();
            int fails = 0, warns = 0;
            for (int i = 0; i < items.Count; i++)
            {
                Check c = items[i];
                lastChecks.Add(c);
                ListViewItem it = new ListViewItem(Badge(c.V));
                it.SubItems.Add(c.Name);
                string detail = c.Detail;
                if (!string.IsNullOrEmpty(c.Fix)) detail = detail + "   |  处理：" + c.Fix;
                it.SubItems.Add(detail);
                it.ForeColor = c.V == Verdict.Fail ? (c.Required ? Critical : Signal)
                    : c.V == Verdict.Warn ? InkMute : c.V == Verdict.Pass ? OkGreen : InkSoft;
                checkList.Items.Add(it);
                if (c.V == Verdict.Fail && c.Required) fails++;
                else if (c.V == Verdict.Warn || c.V == Verdict.Fail) warns++;
            }
            checkList.EndUpdate();

            summaryLabel.Text = "包 " + site.PkgRoot + "   目标 " + site.Target
                + "   端口 " + (site.Port > 0 ? site.Port.ToString(CultureInfo.InvariantCulture) : "(待填)")
                + "   " + (Sys.IsAdmin ? "已提权" : "未提权");
            if (fails == 0)
                summaryLabel.Text = summaryLabel.Text + "   自检通过（另有 " + warns + " 条提示）";
            liveLabel.Text = fails == 0
                ? "自检必需项全过。可以直接点\"起站点（现在）\"先看效果，再决定自启形态。"
                : "有 " + fails + " 项必需检查没过，安装按钮已禁用。逐条看第一页的\"处理\"。";
            UpdateInstallEnabled();
        }

        // 拦安装只看 Required 的 Fail 项：没 csc 只影响仪表盘，站点本身用 run-site.cmd 就能起
        bool Blocked()
        {
            for (int i = 0; i < lastChecks.Count; i++)
            {
                Check c = lastChecks[i];
                if (c.V == Verdict.Fail && c.Required) return true;
            }
            return false;
        }

        void UpdateInstallEnabled()
        {
            if (installButton == null) return;
            bool blocked = Blocked();
            installButton.Enabled = !blocked && !busy;
            applyAutoButton.Enabled = !blocked && !busy;
            installButton.Text = blocked ? "必需项未过（看第 1 页）" : "开始安装";
        }

        // ---- 安装 / 自启 / 维护 动作 ---------------------------------------
        void StartInstall()
        {
            CommitBoxes();
            if (site.Port <= 0)
            {
                AppendLog("[X] 端口要填一个（1-65535）。留空不会替你猜。");
                return;
            }
            RunBusy("安装", delegate
            {
                return Actions.Install(site, nodeInstallCheck.Checked, AppendLog);
            });
        }

        void StartAutostart()
        {
            CommitBoxes();
            string mode = radioBoot.Checked ? Actions.AutoBoot
                : radioNone.Checked ? Actions.AutoNone : Actions.AutoLogon;
            bool withDash = dashCheck.Checked || mode == Actions.AutoLogon;
            RunBusy("自启：" + mode, delegate
            {
                return Actions.ApplyAutostart(site, mode, withDash, AppendLog);
            });
        }

        void StartLiveCheck()
        {
            CommitBoxes();
            RunBusy("实活检查", delegate
            {
                int rc = Actions.LiveCheck(site, AppendLog);
                if (rc == 0) BeginInvoke((Action)delegate { liveLabel.Text = "站点在 " + site.Port + " 上应答正常。"; });
                return rc;
            });
        }

        void StartSiteNow()
        {
            CommitBoxes();
            if (site.Port <= 0) { AppendLog("[X] 没给端口。"); return; }
            RunBusy("起站点", delegate
            {
                bool up = Actions.StartOnce(site, AppendLog);
                AppendLog(up ? "[ok] 站点已起（重启后不会自动再来）" : "[-] 没起来，日志在站点 installer\\run-site.log");
                return up ? 0 : 9;
            });
        }

        void StopSiteNow()
        {
            CommitBoxes();
            AppendLog("[*] 找 " + site.Port + " 上的监听进程…");
            string pid = PidOnPort(site.Port);
            if (pid == null) { AppendLog("[-] 那个口上没人听，不用停。"); return; }
            string o = Sys.RunCapture("taskkill.exe", "/f /pid " + pid);
            AppendLog(string.IsNullOrEmpty(o) ? "[i] taskkill 无输出（可能进程属 SYSTEM，需要提权）" : o);
        }

        void StartUninstall(bool keepFiles)
        {
            CommitBoxes();
            if (!keepFiles)
            {
                DialogResult r = MessageBox.Show(this,
                    "彻底卸载会删掉整个 " + site.Target + "，含档案数据、上传图片、图书文件与明文口令 CSV，"
                    + "不进回收站、不能撤销。\r\n\r\n要继续吗？（下一步还要在弹出的小窗口里输入 DELETE 才真正动手）",
                    "确认彻底卸载", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2);
                if (r != DialogResult.Yes) { AppendLog("[i] 已取消，什么都没删。"); return; }
            }
            RunBusy("卸载", delegate { return Actions.Uninstall(site, keepFiles, null, AppendLog); });
        }

        void OpenSite()
        {
            CommitBoxes();
            if (site.Port <= 0) { AppendLog("[X] 没有端口记录，不知道打开哪儿。"); return; }
            Engine.OpenUrl(site.SiteUrl(site.Port));
        }

        void OpenCreds()
        {
            CommitBoxes();
            string p = Sys.CredentialNotePath(site.Target);
            if (p == null)
            {
                AppendLog("[-] " + site.Target + " 下还没有口令记录——它由后端在站点第一次启动时写出。");
                return;
            }
            AppendLog("[i] 打开 " + p + "（明文，按口令对待，别截图发群里）");
            Engine.OpenUrl("notepad.exe " + "\"" + p + "\"");
        }

        void OpenDashboard()
        {
            CommitBoxes();
            string exe = site.TargetDashExe;
            if (!File.Exists(exe)) { AppendLog("[-] " + exe + " 不在——先跑安装段（现编）"); return; }
            Engine.OpenUrl("\"" + exe + "\"");
        }

        // ---- 基础设施 ------------------------------------------------------
        void CommitBoxes()
        {
            site.Target = SafeFull(targetBox.Text);
            int p;
            if (int.TryParse(portBox.Text.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out p)
                && p > 0 && p <= 65535) site.Port = p;
            else if (portBox.Text.Trim().Length == 0) site.Port = 0;
            site.ResolvePort();
        }

        static string SafeFull(string s)
        {
            try { return Path.GetFullPath((s ?? "").Trim()); } catch (Exception) { return s; }
        }

        void PickFolder()
        {
            FolderBrowserDialog d = new FolderBrowserDialog();
            d.Description = "选一个目录，辨妄阁会装成 <所选>\\Bianwang 或直接装进空目录";
            try { d.SelectedPath = targetBox.Text; } catch (Exception) { }
            if (d.ShowDialog(this) == DialogResult.OK)
            {
                targetBox.Text = d.SelectedPath;
                RunSelfCheck();
            }
        }

        void RelaunchElevated()
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(Application.ExecutablePath, "");
                psi.Verb = "runas";
                psi.UseShellExecute = true;
                Process.Start(psi);
                AppendLog("[i] 已请求提权，新窗口里继续。这个窗口可以关了。");
            }
            catch (Exception ex)
            {
                AppendLog("[-] 提权没成（多半是点了否）：" + ex.Message);
            }
        }

        static string PidOnPort(int port)
        {
            string o = Sys.RunCapture("netstat.exe", "-ano -p TCP");
            if (string.IsNullOrEmpty(o)) return null;
            string suffix = ":" + port.ToString(CultureInfo.InvariantCulture);
            string[] lines = o.Split('\n');
            for (int i = 0; i < lines.Length; i++)
            {
                string l = lines[i].Trim();
                if (l.Length == 0) continue;
                if (l.IndexOf("LISTENING", StringComparison.OrdinalIgnoreCase) < 0) continue;
                string[] parts = l.Split(new char[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length < 5) continue;
                if (parts[1].EndsWith(suffix, StringComparison.Ordinal)) return parts[parts.Length - 1];
            }
            return null;
        }

        void RunBusy(string what, Func<int> work)
        {
            if (busy) { AppendLog("[-] 手上有活：" + currentWork + " 还没结束。"); return; }
            busy = true;
            currentWork = what;
            AppendLog("");
            AppendLog("==== " + what + " ====");
            SetButtons();
            Thread t = new Thread(delegate ()
            {
                int rc = 0;
                try { rc = work(); }
                catch (Exception ex) { AppendLog("[X] " + what + " 抛异常：" + ex.Message); rc = 99; }
                AppendLog("==== " + what + " 结束，退出码 " + rc + " ====");
                busy = false;
                currentWork = "";
                try { BeginInvoke((Action)delegate { SetButtons(); RunSelfCheck(); }); } catch (Exception) { }
            });
            t.IsBackground = true;
            t.Start();
        }

        string currentWork = "";

        void CancelBusy()
        {
            int pid = Engine.LastPid;
            if (pid <= 0) { AppendLog("[-] 现在没有引擎脚本在跑，没得取消。"); return; }
            AppendLog("[*] 取消：终止 PID " + pid + " 及其子进程（cmd → robocopy / node）…");
            Engine.KillTree(pid);
        }

        void SetButtons()
        {
            if (IsDisposed) return;
            try
            {
                cancelButton.Enabled = busy;
                recheckButton.Enabled = !busy;
            }
            catch (Exception) { }
            UpdateInstallEnabled();
        }

        void AppendLog(string s)
        {
            if (logBox == null || logBox.IsDisposed) return;
            if (logBox.InvokeRequired)
            {
                try { logBox.BeginInvoke(new Action<string>(AppendLog), new object[] { s }); } catch (Exception) { }
                return;
            }
            logBox.AppendText((s ?? "") + "\r\n");
        }

        static string Badge(Verdict v)
        {
            if (v == Verdict.Pass) return "[ok]";
            if (v == Verdict.Warn) return "[-]";
            if (v == Verdict.Fail) return "[X]";
            return "[i]";
        }
    }
}
