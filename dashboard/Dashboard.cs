// ============================================================================
// 辨妄阁 · 桌面仪表盘（BianwangLauncher.exe）
//
// 为什么是 WinForms + 自带 csc，而不是 Electron / Python：
//   Electron 会给仓库塞进 100MB 量级的新依赖并触发许可台账重排；Python 等于再引入
//   一个运行环境。本程序只用 Windows 自带的 .NET Framework 4.0 csc.exe 编译，
//   不新增任何 npm 包、不改动许可登记表。
//
// 两条硬要求：
//   1) 手动启动时端口一律留空、必填、每次重新填——配置里记住的端口只服务于
//      --autostart（开机自启）那条路径，因为开机时没人能填；
//   2) 运行环境（Node / pnpm / 依赖 / 前端产物 / 演示数据）逐项体检，缺什么
//      说什么，并给官方下载页直链；只有"项目自己的"动作（装依赖、构建、灌种子）
//      才代跑，装系统级软件一律交回用户点确认。
//   3) 全局访问协议（HTTP / HTTPS）在本程序第 1 栏选，**默认 HTTP**（生产暂无证书）。
//      选 HTTPS 还要定"谁终结 TLS"：本机后端持证书（可用自带 PowerShell 一键出自签证书），
//      或前置 Nginx 终结（后端仍只听明文回环）。这条选择会写进 dashboard.cfg，
//      被 run-site.cmd 与安装器一起读，所以它不是界面标签，是真的换监听方式。
//
// 语言级别：csc 4.0.30319 = C# 5，因此不使用字符串插值、?.、=>、nameof。
// ============================================================================
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Text;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography.X509Certificates;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace Bianwang.Launcher
{
    internal sealed class EnvRow
    {
        public string Name;
        public string Detail;
        public int State;              // 0 正常 / 1 警告 / 2 必需项缺失
        public bool Required;
        public string HelpUrl;
        public string ActionLabel;
        public Action Action;
        public Label StatusLabel;
        public Button HelpButton;
        public Button ActButton;
    }

    internal sealed class Paths
    {
        public string Root;
        public string ServerDir;
        public string WebDistIndex;
        public bool FromPackage;       // true = 部署包里的 api/，false = 仓库源码
        // 离线安装包随带 runtime\BianwangRuntime.exe：那是 Electron 的可执行文件改名，
        // 配上 ELECTRON_RUN_AS_NODE=1 就是本机唯一的 Node 运行时（内建 24.21.0）。
        // 有这个文件就不该再去 PATH 上找 node.exe——装机机上往往根本没装 Node。
        // installer\runtime.cmd 是同一条判定的批处理版本，两处口径必须一致。
        public string BundledRuntime;

        public bool NodeBundled { get { return BundledRuntime != null; } }
        public string NodeExe { get { return NodeBundled ? BundledRuntime : "node.exe"; } }

        static string FindBundledRuntime(string root)
        {
            string p = Path.Combine(root, "runtime", "BianwangRuntime.exe");
            return File.Exists(p) ? p : null;
        }

        // 依次向上找：exe 可能在 dashboard\bin\，也可能被用户搬到别处
        public static Paths Locate()
        {
            string[] seeds = new string[]
            {
                AppDomain.CurrentDomain.BaseDirectory,
                Path.GetDirectoryName(Application.ExecutablePath)
            };
            for (int s = 0; s < seeds.Length; s++)
            {
                try
                {
                    DirectoryInfo dir = new DirectoryInfo(Path.GetFullPath(seeds[s]));
                    while (dir != null)
                    {
                        string repoServer = Path.Combine(dir.FullName, "server");
                        string pkgApi = Path.Combine(dir.FullName, "api");

                        if (File.Exists(Path.Combine(repoServer, "src", "index.js")))
                        {
                            return new Paths
                            {
                                Root = dir.FullName,
                                ServerDir = repoServer,
                                WebDistIndex = Path.Combine(dir.FullName, "web", "dist", "index.html"),
                                FromPackage = false,
                                BundledRuntime = FindBundledRuntime(dir.FullName)
                            };
                        }
                        if (File.Exists(Path.Combine(pkgApi, "src", "index.js")))
                        {
                            return new Paths
                            {
                                Root = dir.FullName,
                                ServerDir = pkgApi,
                                WebDistIndex = Path.Combine(dir.FullName, "web", "dist", "index.html"),
                                FromPackage = true,
                                BundledRuntime = FindBundledRuntime(dir.FullName)
                            };
                        }
                        dir = dir.Parent;
                    }
                }
                catch (Exception) { }
            }
            return null;
        }
    }

    internal sealed class MainForm : Form
    {
        const string AppDir = "Bianwang";
        const string RunKeyPath = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
        const string RunValueName = "BianwangDashboard";

        static readonly Color PaperLeaf = Color.FromArgb(0xfb, 0xf8, 0xf1);
        static readonly Color TerraField = Color.FromArgb(0xf6, 0xf2, 0xe8);
        static readonly Color InkSoft = Color.FromArgb(0x3d, 0x3e, 0x3a);
        static readonly Color InkMute = Color.FromArgb(0x6b, 0x6c, 0x66);
        static readonly Color RuleQuiet = Color.FromArgb(0xc3, 0xbc, 0xac);
        static readonly Color Signal = Color.FromArgb(0xb2, 0x3b, 0x2f);
        static readonly Color SignalInk = Color.FromArgb(0x84, 0x26, 0x1f);
        static readonly Color Critical = Color.FromArgb(0x8c, 0x28, 0x25);
        static readonly Color OkGreen = Color.FromArgb(0x4b, 0x63, 0x45);

        readonly Paths paths;
        readonly string configDir;
        readonly string configFile;
        readonly bool autostartArg;
        readonly Dictionary<string, EnvRow> rows = new Dictionary<string, EnvRow>();

        Process backend;
        TextBox portBox;
        TextBox hostBox;
        Button startButton;
        Button stopButton;
        Button openButton;
        Button recheckButton;
        CheckBox autostartCheck;
        Label stateLabel;
        RichTextBox logBox;
        FlowLayoutPanel envPanel;
        bool autostartWritebackSuppressed;
        int lastPort = 8787;

        // 全局访问协议（需求 3）：HTTP 是默认，HTTPS 是显式选择
        RadioButton httpRadio;
        RadioButton httpsRadio;
        RadioButton tlsNodeRadio;
        RadioButton tlsProxyRadio;
        Panel tlsPane;
        TextBox pfxBox;
        Button certButton;
        Label schemeHint;
        bool schemeWritebackSuppressed;
        readonly Dictionary<string, string> cfg = new Dictionary<string, string>();

        public MainForm(bool autostart)
        {
            autostartArg = autostart;
            paths = Paths.Locate();
            configDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), AppDir);
            configFile = Path.Combine(configDir, "dashboard.cfg");
            LoadCfg();
            BuildShell();
            RefreshEnv();

            if (autostartArg)
            {
                int remembered = ReadRememberedPort();
                if (remembered > 0)
                {
                    portBox.Text = remembered.ToString();
                    Log(string.Format(
                        "[自启] 本次由开机自启触发，沿用上次确认过的端口 {0}（手动启动时端口一律留空、必须重填）。",
                        remembered));
                    StartBackend();
                }
                else
                {
                    Log("[自启] 还没有记住的端口，也不会猜一个来占：请在下方填写端口后点「启动」。");
                }
            }
        }

        // ---------------- 配置（port / scheme / tls_from / tls_pfx 同处一份，谁都不能只写自己那行） ----------------
        void LoadCfg()
        {
            cfg.Clear();
            try
            {
                if (!File.Exists(configFile)) return;
                string[] lines = File.ReadAllLines(configFile);
                for (int i = 0; i < lines.Length; i++)
                {
                    int eq = lines[i].IndexOf('=');
                    if (eq <= 0) continue;
                    cfg[lines[i].Substring(0, eq).Trim()] = lines[i].Substring(eq + 1).Trim();
                }
            }
            catch (Exception) { }
        }

        string CfgValue(string key, string fallback)
        {
            string v;
            if (cfg.TryGetValue(key, out v) && !string.IsNullOrEmpty(v)) return v;
            return fallback;
        }

        void SaveCfg()
        {
            try
            {
                Directory.CreateDirectory(configDir);
                System.Text.StringBuilder sb = new System.Text.StringBuilder();
                string[] keys = new string[] { "port", "scheme", "tls_from", "tls_pfx" };
                for (int i = 0; i < keys.Length; i++)
                {
                    string v;
                    if (cfg.TryGetValue(keys[i], out v) && v.Length > 0)
                        sb.Append(keys[i]).Append('=').Append(v).Append(Environment.NewLine);
                }
                // 认不出的键也留着：别的脚本往里写过的东西不该被界面一次保存抹掉
                foreach (KeyValuePair<string, string> kv in cfg)
                {
                    bool known = false;
                    for (int i = 0; i < keys.Length; i++) if (keys[i] == kv.Key) known = true;
                    if (!known && kv.Value.Length > 0)
                        sb.Append(kv.Key).Append('=').Append(kv.Value).Append(Environment.NewLine);
                }
                File.WriteAllText(configFile, sb.ToString(), new System.Text.UTF8Encoding(false));
            }
            catch (Exception ex)
            {
                Log("[!] 配置写不进去（不影响本次运行）：" + ex.Message);
            }
            SyncSchemeUi();
        }

        void SetCfg(string key, string value)
        {
            cfg[key] = value ?? string.Empty;
            SaveCfg();
        }

        /// <summary>证书包位置：框里填的优先（可以是已有的 pfx），否则用本机默认路径。</summary>
        string TlsPfxPath
        {
            get
            {
                if (pfxBox != null)
                {
                    string t = (pfxBox.Text ?? string.Empty).Trim();
                    if (t.Length > 0) return t;
                }
                return CfgValue("tls_pfx", DefaultPfxPath);
            }
        }
        string DefaultPfxPath { get { return Path.Combine(configDir, "tls", "bianwang-selfsigned.pfx"); } }

        int ReadRememberedPort()
        {
            int v;
            if (int.TryParse(CfgValue("port", ""), out v) && v >= 1 && v <= 65535) return v;
            return -1;
        }

        void WriteRememberedPort(int port)
        {
            cfg["port"] = port.ToString();
            SaveCfg();
        }

        // ---------------- 全局访问协议 ----------------
        bool SchemeIsHttps
        {
            get { return httpsRadio != null && httpsRadio.Checked; }
        }

        bool TlsAtBackend
        {
            get { return tlsNodeRadio != null && tlsNodeRadio.Checked; }
        }

        /// <summary>后端要不要以 TLS 监听：只有"HTTPS + 本机后端终结 + 证书就位"三条同时成立。</summary>
        bool BackendWantsTls()
        {
            return SchemeIsHttps && TlsAtBackend && File.Exists(TlsPfxPath);
        }

        string SiteUrl(int port, string host)
        {
            if (!SchemeIsHttps) return "http://" + host + ":" + port + "/";
            if (TlsAtBackend) return "https://" + host + ":" + port + "/";
            // 前置 Nginx 终结：对外地址不带后端端口（443 是 Nginx 在听），0.0.0.0 也不能当地址用
            string publicHost = host == "0.0.0.0" || host == "::" ? "127.0.0.1" : host;
            return "https://" + publicHost + "/";
        }

        void LoadSchemeFromCfg()
        {
            schemeWritebackSuppressed = true;
            try
            {
                bool https = CfgValue("scheme", "http") == "https";
                httpsRadio.Checked = https;
                httpRadio.Checked = !https;
                bool proxy = CfgValue("tls_from", "node") == "nginx";
                tlsProxyRadio.Checked = proxy;
                tlsNodeRadio.Checked = !proxy;
                string pfx = CfgValue("tls_pfx", "");
                if (pfx.Length > 0) pfxBox.Text = pfx;
            }
            finally { schemeWritebackSuppressed = false; }
        }

        void OnSchemeChanged()
        {
            if (schemeWritebackSuppressed) return;
            cfg["scheme"] = httpsRadio.Checked ? "https" : "http";
            SaveCfg();
            WarnSchemeNeedsRestart();
        }

        void OnTlsTerminatorChanged()
        {
            if (schemeWritebackSuppressed) return;
            cfg["scheme"] = httpsRadio.Checked ? "https" : "http";
            cfg["tls_from"] = tlsProxyRadio.Checked ? "nginx" : "node";
            SaveCfg();
            WarnSchemeNeedsRestart();
        }

        void WarnSchemeNeedsRestart()
        {
            if (backend == null || backend.HasExited) return;
            int port;
            string host;
            if (!PortReady(out port, out host)) port = lastPort > 0 ? lastPort : 0;
            if (port <= 0) return;
            Log("[!] 协议设置已改，但**本次监听不会中途换**：现在的进程还在 " + SiteUrl(port, host)
                + " 上，点「停止」再起一次才切过去。");
        }

        void SyncSchemeUi()
        {
            if (tlsPane == null || schemeHint == null) return;
            bool https = httpsRadio.Checked;
            tlsPane.Visible = https;
            bool atBackend = tlsNodeRadio.Checked;
            pfxBox.Visible = atBackend;
            certButton.Visible = atBackend;

            string hint;
            if (!https)
            {
                hint = "默认档。内网直连就能用，但链路不加密：口令与正文在网线上是明文，别朝公网开。";
            }
            else if (atBackend)
            {
                string pfx = TlsPfxPath;
                hint = File.Exists(pfx)
                    ? "node 用这个证书包直接以 TLS 监听（自签＝浏览器会先告警，只适合内网/自用）。"
                    : "还没有证书：点右边按钮用系统自带 PowerShell 出一张自签的，或把已有的 pfx 路径填进来。";
                if (HasNonAscii(pfx))
                    hint += " 证书路径含中文：run-site.cmd（开机自启那条）按 OEM 码页读不到它，请改用纯英文路径。";
            }
            else
            {
                hint = "后端仍按明文 HTTP 只监听回环，https 由前置 Nginx 的 443 + 证书提供；"
                    + "本程序只管访问地址，不校验 Nginx 是否已经配好。";
            }
            schemeHint.Text = hint;
        }

        static bool HasNonAscii(string s)
        {
            if (s == null) return false;
            for (int i = 0; i < s.Length; i++) if (s[i] > 127) return true;
            return false;
        }

        /// <summary>证书包的一句话明细（只读公钥信息，读不动就退化成体积）。</summary>
        static string CertBrief(string pfxPath)
        {
            try
            {
                using (X509Certificate2 c = new X509Certificate2(pfxPath, string.Empty))
                {
                    return "到期 " + c.GetExpirationDateString() + " · " + c.Subject;
                }
            }
            catch (Exception)
            {
                try { return new FileInfo(pfxPath).Length + " 字节（明细读不出，可能被别处占用）"; }
                catch (Exception) { return "明细读不出"; }
            }
        }

        // ---------------- 自签证书（只用系统自带的 PowerShell，不引第三方） ----------------
        static readonly string SelfSignedScript = string.Join("\r\n", new string[]
        {
            "$ErrorActionPreference = 'Stop'",
            "$pfx = $args[0]",
            "$dir = Split-Path -Parent $pfx",
            "if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }",
            "$cn = [string](Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\ComputerName\\ComputerName' -Name ComputerName).ComputerName",
            "$dns = @('localhost', $cn) + ($args | Select-Object -Skip 1 | Where-Object { $_ })",
            "$old = Get-ChildItem Cert:\\CurrentUser\\My -ErrorAction SilentlyContinue | Where-Object { $_.Subject -eq 'CN=Bianwang self-signed' }",
            "foreach ($c in $old) { Remove-Item \"Cert:\\CurrentUser\\My\\$($c.Thumbprint)\" -ErrorAction SilentlyContinue }",
            "$cert = New-SelfSignedCertificate -Subject 'CN=Bianwang self-signed' -DnsName $dns -CertStoreLocation 'Cert:\\CurrentUser\\My' -NotAfter (Get-Date).AddYears(1) -KeyExportPolicy Exportable -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeyUsage DigitalSignature, KeyEncipherment -FriendlyName 'Bianwang local TLS'",
            "if (Test-Path $pfx) { Remove-Item $pfx -Force }",
            "$empty = New-Object System.Security.SecureString",
            "Export-PfxCertificate -Cert \"Cert:\\CurrentUser\\My\\$($cert.Thumbprint)\" -FilePath $pfx -Password $empty | Out-Null",
            "Write-Output ('OK thumbprint=' + $cert.Thumbprint + ' notAfter=' + $cert.NotAfter.ToString('yyyy-MM-dd') + ' dns=' + ($dns -join ','))",
        });

        void MakeSelfSignedCert()
        {
            string pfx = TlsPfxPath;
            DialogResult ask = MessageBox.Show(
                "自签证书要说清楚它是什么，再决定要不要生成：\r\n\r\n"
                + "  · 浏览器会先弹「您的连接不是私密连接」——它不是公网可信证书，只适合内网/自用；\r\n"
                + "  · 用的是 Windows 自带的 New-SelfSignedCertificate（当前用户证书库，不要管理员、不装第三方）；\r\n"
                + "  · 私钥会落在下面这个文件，空口令导出，边界只有 NTFS 权限，别把它拷给别人：\r\n    "
                + pfx + "\r\n\r\n"
                + "正式对外站点请改用域名证书，或把 TLS 交给前置 Nginx。仍要现在生成吗？",
                "辨妄阁 · 生成本机自签证书",
                MessageBoxButtons.YesNoCancel, MessageBoxIcon.Warning);
            if (ask != DialogResult.Yes)
            {
                Log("[ ] 没有生成证书（对话框选了「否/取消」）。协议保持现状，什么都没改。");
                return;
            }

            int port;
            string host;
            PortReady(out port, out host);
            string extraSan = string.Empty;
            if (host.Length > 0 && host != "127.0.0.1" && host != "0.0.0.0" && host != "::")
                extraSan = host;

            Log("[>] 生成自签证书（New-SelfSignedCertificate → 导出 pfx）…");
            string scriptPath;
            try
            {
                Directory.CreateDirectory(Path.Combine(configDir, "tls"));
                scriptPath = Path.Combine(configDir, "tls", "make-selfsigned.ps1");
                File.WriteAllText(scriptPath, SelfSignedScript, new System.Text.UTF8Encoding(true));
            }
            catch (Exception ex)
            {
                Log("[✗] 证书脚本写不下去：" + ex.Message);
                return;
            }

            string arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + scriptPath + "\" \"" + pfx + "\""
                + (extraSan.Length > 0 ? " \"" + extraSan + "\"" : string.Empty);
            ThreadPool.QueueUserWorkItem(delegate
            {
                bool ok = false;
                try
                {
                    ProcessStartInfo psi = new ProcessStartInfo("powershell.exe", arguments);
                    psi.UseShellExecute = false;
                    psi.RedirectStandardOutput = true;
                    psi.RedirectStandardError = true;
                    psi.CreateNoWindow = true;
                    using (Process p = Process.Start(psi))
                    {
                        string o = p.StandardOutput.ReadToEnd();
                        string e = p.StandardError.ReadToEnd();
                        p.WaitForExit();
                        if (o.Length > 0) LogLines(o);
                        if (e.Length > 0) LogLines(e);
                        ok = p.ExitCode == 0 && File.Exists(pfx);
                    }
                }
                catch (Exception ex)
                {
                    Log("[✗] 调不动 PowerShell：" + ex.Message);
                }

                if (ok)
                {
                    Log("[✓] 自签证书已就位：" + pfx);
                    Log("[!] 提醒：自签=浏览器会告警，只适合内网/自用；正式站点请换域名证书或交给前置 Nginx。");
                    try
                    {
                        BeginInvoke(new Action(delegate
                        {
                            schemeWritebackSuppressed = true;
                            try
                            {
                                httpsRadio.Checked = true;
                                tlsNodeRadio.Checked = true;
                                pfxBox.Text = pfx;
                            }
                            finally { schemeWritebackSuppressed = false; }
                            cfg["scheme"] = "https";
                            cfg["tls_from"] = "node";
                            cfg["tls_pfx"] = pfx;
                            SaveCfg();
                            RefreshEnv();
                        }));
                    }
                    catch (Exception) { }
                }
                else
                {
                    Log("[✗] 证书没生成成功（见上面 PowerShell 原话）。协议没动，也不会因此起不来——"
                        + "可以先改回 HTTP，或把已有的 pfx 路径填进证书框。");
                }
                try { File.Delete(scriptPath); } catch (Exception) { }
            });
        }


        // ---------------- 字体：绝不写死单一字族 ----------------
        // 之前硬编码 "Microsoft YaHei UI"，这台机器恰好装了所以看着正常；换一台没装
        // 该字族的 Windows，GDI+ 会静默回退到没有中文字形的字体，界面立刻变成方块/乱码。
        // 所以改成按候选链探测本机实际装了哪个，全都没有才退回系统默认字体。
        static readonly string UiFamily = ResolveUiFamily();

        static string ResolveUiFamily()
        {
            string[] candidates = new string[]
            {
                "Microsoft YaHei UI", "Microsoft YaHei",
                "PingFang SC", "Noto Sans CJK SC", "Source Han Sans SC",
                "SimHei", "SimSun", "NSimSun", "KaiTi", "FangSong",
                "Malgun Gothic", "Yu Gothic UI", "Meiryo UI", "Segoe UI"
            };
            try
            {
                using (InstalledFontCollection installed = new InstalledFontCollection())
                {
                    foreach (string want in candidates)
                        foreach (FontFamily f in installed.Families)
                            if (string.Equals(f.Name, want, StringComparison.OrdinalIgnoreCase))
                                return f.Name;
                }
            }
            catch (Exception) { }
            try { return SystemFonts.DefaultFont.FontFamily.Name; }
            catch (Exception) { return FontFamily.GenericSansSerif.Name; }
        }

        static Font Ui(float size) { return new Font(UiFamily, size, FontStyle.Regular, GraphicsUnit.Point); }
        static Font Ui(float size, FontStyle style) { return new Font(UiFamily, size, style, GraphicsUnit.Point); }

        // ---------------- 界面 ----------------
        void BuildShell()
        {
            Text = "辨妄阁 · 运行仪表盘";
            BackColor = PaperLeaf;
            ForeColor = InkSoft;
            Font = Ui(9F);
            ClientSize = new Size(716, 772);
            MinimumSize = new Size(690, 700);
            StartPosition = FormStartPosition.CenterScreen;
            FormClosing += OnFormClosing;

            TableLayoutPanel outer = new TableLayoutPanel();
            outer.Dock = DockStyle.Fill;
            outer.ColumnCount = 1;
            outer.RowCount = 4;
            outer.RowStyles.Add(new RowStyle(SizeType.Absolute, 78F));
            outer.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            outer.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            outer.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
            outer.Padding = new Padding(16, 12, 16, 12);
            Controls.Add(outer);

            // —— 标题条：左侧朱砂标识脊，横排标题 ——
            Panel head = new Panel();
            head.Dock = DockStyle.Fill;
            head.BackColor = PaperLeaf;
            head.Paint += delegate(object s, PaintEventArgs e)
            {
                using (Pen p = new Pen(Signal, 3F))
                    e.Graphics.DrawLine(p, 0, 6, 0, head.ClientSize.Height - 6);
                using (Pen p = new Pen(RuleQuiet, 1F))
                    e.Graphics.DrawLine(p, 8, head.ClientSize.Height - 2, head.ClientSize.Width, head.ClientSize.Height - 2);
            };
            Label title = new Label();
            title.Text = "辨妄阁 · 运行仪表盘";
            title.Font = Ui(15F, FontStyle.Bold);
            title.ForeColor = InkSoft;
            title.AutoSize = true;
            title.Location = new Point(12, 8);
            head.Controls.Add(title);
            Label sub = new Label();
            string where = paths == null ? "未定位到站点目录"
                : (paths.FromPackage ? "部署包 api/" : "源码仓库 server/") + paths.Root;
            sub.Text = where + "     ·     炎国档案体例 · 单机可视化起停";
            sub.ForeColor = InkMute;
            sub.AutoSize = true;
            sub.Location = new Point(14, 44);
            head.Controls.Add(sub);
            outer.Controls.Add(head, 0, 0);

            // —— 端口与协议区：需求 1 + 需求 3 ——
            GroupBox portPane = new GroupBox();
            portPane.Text = "运行端口与全局访问协议（端口每次手动启动都要填；协议记住，改了要重启站点才生效）";
            portPane.Dock = DockStyle.Fill;
            portPane.Height = 204;
            portPane.ForeColor = SignalInk;
            portPane.BackColor = TerraField;
            outer.Controls.Add(portPane, 0, 1);

            Label pl = new Label();
            pl.Text = "端口";
            pl.AutoSize = true;
            pl.ForeColor = InkSoft;
            pl.Location = new Point(14, 30);
            portPane.Controls.Add(pl);

            portBox = new TextBox();
            portBox.Location = new Point(58, 27);
            portBox.Width = 84;
            portBox.Font = Ui(12F, FontStyle.Bold);
            portBox.TextAlign = HorizontalAlignment.Center;
            portBox.BackColor = PaperLeaf;
            // 关键：绝不预填。手动启动一律空白，逼一次真实的确认。
            portBox.TextChanged += delegate { SyncButtonStates(); };
            portBox.KeyDown += delegate(object s, KeyEventArgs e)
            {
                if (e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; StartBackend(); }
            };
            portPane.Controls.Add(portBox);

            Label hl = new Label();
            hl.Text = "监听";
            hl.AutoSize = true;
            hl.ForeColor = InkSoft;
            hl.Location = new Point(160, 30);
            portPane.Controls.Add(hl);

            hostBox = new TextBox();
            hostBox.Location = new Point(204, 27);
            hostBox.Width = 110;
            hostBox.Text = "127.0.0.1";
            hostBox.BackColor = PaperLeaf;
            hostBox.TextChanged += delegate { SyncButtonStates(); };
            portPane.Controls.Add(hostBox);
            Label hostHint = new Label();
            hostHint.Text = "默认只听回环，交给 Nginx 反代；填 0.0.0.0 就是直接对全网开放";
            hostHint.AutoSize = true;
            hostHint.ForeColor = InkMute;
            hostHint.Location = new Point(322, 30);
            portPane.Controls.Add(hostHint);

            startButton = new Button();
            startButton.Text = "启动站点";
            startButton.Location = new Point(14, 62);
            startButton.Size = new Size(112, 34);
            startButton.FlatStyle = FlatStyle.Flat;
            startButton.BackColor = Signal;
            startButton.ForeColor = Color.White;
            startButton.FlatAppearance.BorderColor = SignalInk;
            startButton.Click += delegate { StartBackend(); };
            portPane.Controls.Add(startButton);

            stopButton = new Button();
            stopButton.Text = "停止";
            stopButton.Location = new Point(134, 62);
            stopButton.Size = new Size(76, 34);
            stopButton.Enabled = false;
            stopButton.Click += delegate { StopBackend(); };
            portPane.Controls.Add(stopButton);

            openButton = new Button();
            openButton.Text = "在浏览器打开";
            openButton.Location = new Point(218, 62);
            openButton.Size = new Size(112, 34);
            openButton.Enabled = false;
            openButton.Click += delegate { OpenSite(); };
            portPane.Controls.Add(openButton);

            stateLabel = new Label();
            stateLabel.Text = "未运行";
            stateLabel.AutoSize = true;
            stateLabel.ForeColor = InkMute;
            stateLabel.Location = new Point(344, 71);
            portPane.Controls.Add(stateLabel);

            // —— 全局访问协议（需求 3）：默认 HTTP，HTTPS 是显式选择，且必须说清谁终结 TLS ——
            Label sl = new Label();
            sl.Text = "访问协议";
            sl.AutoSize = true;
            sl.ForeColor = InkSoft;
            sl.Location = new Point(14, 106);
            portPane.Controls.Add(sl);

            httpRadio = new RadioButton();
            httpRadio.Text = "HTTP";
            httpRadio.AutoSize = true;
            httpRadio.ForeColor = InkSoft;
            httpRadio.BackColor = Color.Transparent;
            httpRadio.Location = new Point(74, 104);
            httpRadio.Checked = true;
            httpRadio.Click += delegate { OnSchemeChanged(); };
            portPane.Controls.Add(httpRadio);

            httpsRadio = new RadioButton();
            httpsRadio.Text = "HTTPS";
            httpsRadio.AutoSize = true;
            httpsRadio.ForeColor = InkSoft;
            httpsRadio.BackColor = Color.Transparent;
            httpsRadio.Location = new Point(142, 104);
            httpsRadio.Click += delegate { OnSchemeChanged(); };
            portPane.Controls.Add(httpsRadio);

            schemeHint = new Label();
            schemeHint.Text = "";
            schemeHint.AutoSize = true;
            schemeHint.ForeColor = InkMute;
            schemeHint.Location = new Point(224, 106);
            schemeHint.MaximumSize = new Size(460, 0);
            portPane.Controls.Add(schemeHint);

            tlsPane = new Panel();
            tlsPane.Location = new Point(14, 128);
            tlsPane.Size = new Size(672, 34);
            tlsPane.BackColor = Color.Transparent;
            portPane.Controls.Add(tlsPane);

            Label tl = new Label();
            tl.Text = "TLS 由谁终结";
            tl.AutoSize = true;
            tl.ForeColor = InkSoft;
            tl.Location = new Point(0, 8);
            tlsPane.Controls.Add(tl);

            tlsNodeRadio = new RadioButton();
            tlsNodeRadio.Text = "本机后端持证书";
            tlsNodeRadio.AutoSize = true;
            tlsNodeRadio.ForeColor = InkSoft;
            tlsNodeRadio.BackColor = Color.Transparent;
            tlsNodeRadio.Location = new Point(84, 6);
            tlsNodeRadio.Checked = true;
            tlsNodeRadio.Click += delegate { OnTlsTerminatorChanged(); };
            tlsPane.Controls.Add(tlsNodeRadio);

            tlsProxyRadio = new RadioButton();
            tlsProxyRadio.Text = "前置 Nginx";
            tlsProxyRadio.AutoSize = true;
            tlsProxyRadio.ForeColor = InkSoft;
            tlsProxyRadio.BackColor = Color.Transparent;
            tlsProxyRadio.Location = new Point(206, 6);
            tlsProxyRadio.Click += delegate { OnTlsTerminatorChanged(); };
            tlsPane.Controls.Add(tlsProxyRadio);

            pfxBox = new TextBox();
            pfxBox.Location = new Point(310, 4);
            pfxBox.Width = 236;
            pfxBox.BackColor = PaperLeaf;
            pfxBox.TextChanged += delegate { SyncSchemeUi(); };
            tlsPane.Controls.Add(pfxBox);

            certButton = new Button();
            certButton.Text = "生成本机自签证书";
            certButton.Location = new Point(552, 2);
            certButton.Size = new Size(118, 27);
            certButton.FlatStyle = FlatStyle.Flat;
            certButton.FlatAppearance.BorderColor = RuleQuiet;
            certButton.Click += delegate { MakeSelfSignedCert(); };
            tlsPane.Controls.Add(certButton);

            autostartCheck = new CheckBox();
            autostartCheck.Text = "登录 Windows 后自动起站（沿用上次端口与协议，开机不再问）";
            autostartCheck.AutoSize = true;
            autostartCheck.ForeColor = InkSoft;
            autostartCheck.Location = new Point(14, 170);
            autostartCheck.CheckedChanged += OnAutostartToggled;
            portPane.Controls.Add(autostartCheck);
            LoadSchemeFromCfg();
            SyncAutostartCheckbox();
            SyncSchemeUi();

            // —— 环境区：需求 2 ——
            GroupBox envPane = new GroupBox();
            envPane.Text = "运行环境体检（缺什么说什么，装系统软件由你点确认）";
            envPane.Dock = DockStyle.Fill;
            envPane.ForeColor = SignalInk;
            envPane.BackColor = PaperLeaf;
            outer.Controls.Add(envPane, 0, 2);

            recheckButton = new Button();
            recheckButton.Text = "重新体检";
            recheckButton.Location = new Point(12, 22);
            recheckButton.Size = new Size(96, 28);
            recheckButton.Click += delegate { RefreshEnv(); };
            envPane.Controls.Add(recheckButton);

            envPanel = new FlowLayoutPanel();
            envPanel.Location = new Point(12, 56);
            envPanel.Size = new Size(676, 252);
            envPanel.AutoScroll = true;
            // 默认是 LeftToRight：不改成 TopDown，七行体检会横着排成一条，只剩第一行可见
            envPanel.FlowDirection = FlowDirection.TopDown;
            envPanel.WrapContents = false;
            envPanel.BackColor = TerraField;
            envPanel.BorderStyle = BorderStyle.None;
            envPane.Controls.Add(envPanel);
            envPane.Height = 322;

            // —— 日志 ——
            GroupBox logPane = new GroupBox();
            logPane.Text = "后端输出";
            logPane.Dock = DockStyle.Fill;
            logPane.ForeColor = SignalInk;
            outer.Controls.Add(logPane, 0, 3);

            logBox = new RichTextBox();
            logBox.Dock = DockStyle.Fill;
            logBox.ReadOnly = true;
            logBox.BackColor = PaperLeaf;
            logBox.ForeColor = InkSoft;
            logBox.BorderStyle = BorderStyle.None;
            // Consolas 没有中文字形，后端日志里全是中文，写死它只能靠字体链接救急、换机就变方块
            logBox.Font = Ui(9F);
            logPane.Controls.Add(logBox);
        }

        void BuildEnvRow(EnvRow row)
        {
            Panel line = new Panel();
            line.Width = 650;
            line.Height = 34;
            line.Margin = new Padding(2, 2, 2, 2);
            line.BackColor = PaperLeaf;

            Label mark = new Label();
            // 不用 ✓/✗：这两个符号（U+2713/U+2717）在中文字体里常常没有字形，又会变成方块；
            // 而且读屏软件念不出"一个勾"代表什么。直接写状态词。
            mark.Text = row.State == 0 ? "正常" : (row.State == 1 ? "警告" : "缺失");
            mark.Font = Ui(9F, FontStyle.Bold);
            mark.ForeColor = row.State == 0 ? OkGreen : (row.State == 1 ? InkMute : Critical);
            mark.AutoSize = true;
            mark.Location = new Point(6, 9);
            line.Controls.Add(mark);

            Label name = new Label();
            name.Text = row.Name;
            name.Font = Ui(9F, FontStyle.Bold);
            name.ForeColor = InkSoft;
            name.AutoSize = true;
            name.Location = new Point(46, 10);
            line.Controls.Add(name);

            Label detail = new Label();
            detail.Text = row.Detail;
            detail.ForeColor = row.State == 2 ? Critical : InkMute;
            detail.AutoEllipsis = true;
            detail.Width = 300;
            detail.Height = 18;
            int detailX = 46 + TextRenderer.MeasureText(row.Name, name.Font).Width + 10;
            if (detailX > 300) detailX = 300;
            detail.Location = new Point(detailX, 10);
            line.Controls.Add(detail);

            Button act = new Button();
            act.Text = row.ActionLabel;
            act.Size = new Size(104, 24);
            act.Location = new Point(496, 5);
            act.Enabled = row.Action != null;
            act.Visible = !string.IsNullOrEmpty(row.ActionLabel);
            act.FlatStyle = FlatStyle.Flat;
            act.FlatAppearance.BorderColor = RuleQuiet;
            act.BackColor = PaperLeaf;
            Action handler = row.Action;
            if (handler != null) act.Click += delegate { handler(); };
            line.Controls.Add(act);

            Button help = new Button();
            help.Text = "指引";
            help.Size = new Size(48, 24);
            help.Location = new Point(600, 5);
            help.Visible = !string.IsNullOrEmpty(row.HelpUrl);
            help.FlatStyle = FlatStyle.Flat;
            help.FlatAppearance.BorderColor = RuleQuiet;
            string url = row.HelpUrl;
            help.Click += delegate { OpenUrl(url); };
            line.Controls.Add(help);

            row.StatusLabel = mark;
            row.ActButton = act;
            row.HelpButton = help;
            envPanel.Controls.Add(line);
            rows[row.Name] = row;
        }

        // ---------------- 环境体检 ----------------
        void RefreshEnv()
        {
            envPanel.SuspendLayout();
            envPanel.Controls.Clear();
            rows.Clear();

            if (paths == null)
            {
                BuildEnvRow(new EnvRow
                {
                    Name = "站点目录",
                    Detail = "没找到 server/src/index.js 或 api/src/index.js",
                    State = 2,
                    Required = true,
                    ActionLabel = "",
                    HelpUrl = ""
                });
                Log("[✗] 没定位到站点目录：把本 exe 放进站点根目录（或根目录的子目录，如 dashboard\\bin\\）下再打开。");
                SyncButtonStates();
                envPanel.ResumeLayout();
                return;
            }

            BuildEnvRow(new EnvRow
            {
                Name = "站点目录",
                Detail = (paths.FromPackage ? "部署包 api/" : "源码 server/") + paths.Root,
                State = 0,
                ActionLabel = ""
            });

            Version node = ProbeNode();
            bool nodeOk = node != null && (node.Major > 20 || (node.Major == 20 && (node.Minor > 19 || node.Minor == 19)));
            // 离线安装包随带 runtime\BianwangRuntime.exe，这台机器上并没有、也不需要
            // 系统级 Node.js。这一行必须说清用的是哪一个运行时，否则"没装 Node"的提示
            // 会把操作员送去装一个装完也不会被用到的东西。
            EnvRow nodeRow = new EnvRow
            {
                Name = paths.NodeBundled ? "Node 运行时（随包）" : "Node.js",
                Detail = node == null
                    ? (paths.NodeBundled
                        ? "随包运行时存在，但 -v 没回话：检查 runtime\\BianwangRuntime.exe 是否完整"
                        : "没装（站点后端要 >= 20.19.0）。离线安装包自带运行时，不必单独装 Node.js")
                    : (paths.NodeBundled ? "包内 Electron 内建 " : "") + node.ToString()
                        + (nodeOk ? "，满足 >= 20.19.0" : "，低于要求的 20.19.0"),
                State = node == null ? 2 : (nodeOk ? 0 : 1),
                Required = true,
                ActionLabel = node == null ? "" : "版本明细",
                HelpUrl = "https://nodejs.org/zh-cn/download"
            };
            if (node != null)
                nodeRow.Action = delegate { Log("[Node] " + NodeCapture("-v")); };
            BuildEnvRow(nodeRow);

            string pnpmVer = ProbePnpm();
            bool needPnpm = !paths.FromPackage;
            BuildEnvRow(new EnvRow
            {
                Name = "pnpm",
                Detail = pnpmVer == null
                    ? (needPnpm ? "没装（源码装依赖与构建要用）" : "没装（部署包已自带依赖，可不装）")
                    : pnpmVer,
                State = pnpmVer == null ? (needPnpm ? 1 : 0) : 0,
                Required = false,
                ActionLabel = "",
                HelpUrl = "https://pnpm.io/installation"
            });

            // 目录在不在 ≠ 依赖能不能解析。pnpm 的依赖农场在**仓库根**的 node_modules/.pnpm 里，
            // server/node_modules/* 全是指向它的软链接。只把 server/ 拷到别的机器时，
            // 包体自己被解引用带过去了、它的兄弟依赖（如 ip-address）没带，
            // 于是 node 直到 import 阶段才炸 ERR_MODULE_NOT_FOUND。所以这里真跑一次 import。
            DepProbe probe = ProbeDeps();
            bool depsOk = probe.Ok;
            EnvRow depsRow = new EnvRow
            {
                Name = "依赖",
                Detail = probe.Detail,
                State = depsOk ? 0 : 2,
                Required = true,
                ActionLabel = (!depsOk && needPnpm) ? "装依赖" : ""
            };
            if (!depsOk && needPnpm)
                depsRow.Action = delegate { RunStep("pnpm install", "install", null); };
            BuildEnvRow(depsRow);

            bool distOk = File.Exists(paths.WebDistIndex);
            EnvRow distRow = new EnvRow
            {
                Name = "前端产物",
                Detail = distOk
                    ? "web/dist 就位（Nginx 的 root 就指这里）"
                    : (paths.FromPackage ? "没找到 web/dist/index.html" : "还没构建：没构建就只能看到后端，页面是空的"),
                State = distOk ? 0 : 1,
                ActionLabel = (!distOk && !paths.FromPackage) ? "构建前端" : ""
            };
            if (!distOk && !paths.FromPackage)
                distRow.Action = delegate { RunStep("pnpm build", "build", null); };
            BuildEnvRow(distRow);

            bool dataOk = File.Exists(Path.Combine(paths.ServerDir, "data", "posts.json"));
            EnvRow dataRow = new EnvRow
            {
                Name = "数据",
                Detail = dataOk ? "server/data 有档案" : "还没有数据文件（可灌一份出厂演示数据）",
                State = 0,
                ActionLabel = dataOk ? "" : "灌演示数据"
            };
            if (!dataOk)
                dataRow.Action = delegate { RunStep("reseed", "seed", null); };
            BuildEnvRow(dataRow);

            // 协议这一行要说的是"这一档到底成没成立"，不是把标签复读一遍：
            // HTTPS + 本机后端但证书不在，就是一个货真价实的缺失项。
            bool https = SchemeIsHttps;
            bool atBackend = TlsAtBackend;
            string pfxPath = TlsPfxPath;
            bool pfxThere = File.Exists(pfxPath);
            string certInfo = pfxThere ? CertBrief(pfxPath) : string.Empty;
            int tlsState = 0;
            string tlsDetail;
            if (!https)
                tlsDetail = "当前按明文 HTTP 起站（默认档）：内网可用，别朝公网开放这个端口";
            else if (atBackend)
            {
                tlsState = pfxThere ? 0 : 2;
                tlsDetail = pfxThere
                    ? "node 以 TLS 监听 · 证书 " + Path.GetFileName(pfxPath) + "（" + certInfo + "）"
                    : "选了 HTTPS + 本机后端，但证书包不存在：" + pfxPath;
            }
            else
                tlsDetail = "TLS 交给前置 Nginx：后端仍按明文 HTTP 只监听回环，443 与证书要自己在 Nginx 配";
            EnvRow tlsRow = new EnvRow
            {
                Name = "协议",
                Detail = tlsDetail,
                State = tlsState,
                // 故意不标 Required：缺证书时"起不来"的话由 StartBackend 那三条明示来说，
                // 比通用的一句"必需项没通过"更准（那行也自带「出自签证书」按钮，不用去点指引）。
                Required = false,
                ActionLabel = https && atBackend && !pfxThere ? "出自签证书" : (pfxThere ? "证书明细" : "")
            };
            if (https && atBackend && !pfxThere) tlsRow.Action = delegate { MakeSelfSignedCert(); };
            else if (pfxThere)
                tlsRow.Action = delegate { Log("[TLS] " + pfxPath + " · " + certInfo); };
            BuildEnvRow(tlsRow);

            Log("[体检] Node=" + (node == null ? "缺失" : node.ToString())
                + " · pnpm=" + (pnpmVer == null ? "缺失" : pnpmVer)
                + " · 依赖=" + (depsOk ? "有" : "无")
                + " · dist=" + (distOk ? "有" : "无")
                + " · 数据=" + (dataOk ? "有" : "无")
                + " · 协议=" + (https ? (atBackend ? "https（本机证书）" : "https（前置 Nginx）") : "http"));
            SyncButtonStates();
            envPanel.ResumeLayout();
        }

        // 起 Node 子进程的唯一入口。离线包用随带运行时（改名后的 Electron，配
        // ELECTRON_RUN_AS_NODE=1 就是 node），仓库与压缩包仍旧用 PATH 上的 node.exe。
        // 之所以只留一个入口：以前四处各自写死 "node.exe"，换成离线包就会同时瞎掉。
        ProcessStartInfo NodeStartInfo(string args)
        {
            string exe = paths == null ? "node.exe" : paths.NodeExe;
            ProcessStartInfo psi = new ProcessStartInfo(exe, args);
            psi.UseShellExecute = false;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.CreateNoWindow = true;
            if (paths != null && paths.NodeBundled) psi.EnvironmentVariables["ELECTRON_RUN_AS_NODE"] = "1";
            return psi;
        }

        Version ProbeNode()
        {
            try
            {
                ProcessStartInfo psi = NodeStartInfo("-v");
                using (Process p = Process.Start(psi))
                {
                    string o = p.StandardOutput.ReadToEnd();
                    p.WaitForExit(4000);
                    o = o.Trim().TrimStart('v');
                    if (o.Length == 0) return null;
                    Version v;
                    if (Version.TryParse(o, out v)) return v;
                }
            }
            catch (Exception) { }
            return null;
        }

        static string ProbePnpm()
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("cmd.exe", "/c pnpm -v");
                psi.UseShellExecute = false;
                psi.RedirectStandardOutput = true;
                psi.CreateNoWindow = true;
                using (Process p = Process.Start(psi))
                {
                    string o = p.StandardOutput.ReadToEnd();
                    p.WaitForExit(6000);
                    o = o.Trim();
                    if (o.Length == 0 || o.IndexOf("not recognized", StringComparison.OrdinalIgnoreCase) >= 0) return null;
                    return o;
                }
            }
            catch (Exception) { }
            return null;
        }

        // 后端启动期真正 import 的外部包（与 server/src 的静态 import 图一致）。
        // 少一个就会以 ERR_MODULE_NOT_FOUND 崩在监听之前，所以体检必须逐个真解析。
        static readonly string[] StartupImports = new string[]
        {
            "express", "express-rate-limit", "sanitize-html", "minisearch", "multer",
            "cookie-parser", "csv-parse/sync", "csv-stringify/sync", "diff",
            "@rgrove/parse-xml", "pdfjs-dist/legacy/build/pdf.mjs"
        };

        sealed class DepProbe
        {
            public bool Ok;
            public string Detail;
        }

        DepProbe ProbeDeps()
        {
            DepProbe r = new DepProbe { Ok = false, Detail = "没探到" };
            if (paths == null) { r.Detail = "没定位到站点目录，无从探测"; return r; }

            string serverNM = Path.Combine(paths.ServerDir, "node_modules");
            string rootFarm = Path.Combine(paths.Root, "node_modules", ".pnpm");
            bool hasServerNM = Directory.Exists(serverNM);
            bool hasFarm = Directory.Exists(rootFarm);

            if (!hasServerNM && !(paths.FromPackage && Directory.Exists(serverNM)))
            {
                if (!paths.FromPackage && !hasFarm && !Directory.Exists(Path.Combine(paths.Root, "node_modules")))
                {
                    r.Detail = "依赖没装：在仓库根跑 pnpm install --frozen-lockfile";
                    return r;
                }
            }

            try
            {
                // 探针必须落在 server/ 里，不能放 %TEMP%：
                // ESM 的裸模块名是按**发起 import 的那个文件的位置**逐级向上找 node_modules 的，
                // 跟进程 cwd 无关。放 TEMP 里跑，健康的安装也会被判成"全部缺包"而误挡启动。
                string scriptPath = Path.Combine(paths.ServerDir, ".bianwang-deps-probe.mjs");
                System.Text.StringBuilder sb = new System.Text.StringBuilder();
                sb.Append("const specs=[");
                for (int i = 0; i < StartupImports.Length; i++)
                {
                    if (i > 0) sb.Append(',');
                    sb.Append('"').Append(StartupImports[i]).Append('"');
                }
                sb.Append("];const bad=[];for(const s of specs){try{await import(s)}catch(e){bad.push(s+' <- '+((e&&e.code)||'ERR'))}}");
                sb.Append("if(bad.length){console.log('MISS|'+bad.join(', '))}else{console.log('OK')}");
                File.WriteAllText(scriptPath, sb.ToString(), new System.Text.UTF8Encoding(false));

                string stdout;
                try
                {
                    ProcessStartInfo psi = NodeStartInfo("\"" + scriptPath + "\"");
                    psi.WorkingDirectory = paths.ServerDir;
                    using (Process p = Process.Start(psi))
                    {
                        stdout = p.StandardOutput.ReadToEnd();
                        p.StandardError.ReadToEnd();
                        if (!p.WaitForExit(60000)) { try { p.Kill(); } catch (Exception) { } }
                        stdout = (stdout ?? string.Empty).Trim();
                    }
                }
                finally
                {
                    try { File.Delete(scriptPath); } catch (Exception) { }
                }

                if (stdout == "OK")
                {
                    r.Ok = true;
                    r.Detail = paths.FromPackage
                        ? "api/node_modules 自足，启动期 import 全部可解析"
                        : "启动期 import 全部可解析（依赖农场在仓库根，正常）";
                    return r;
                }

                string missing = stdout.StartsWith("MISS|") ? stdout.Substring(5) : stdout;
                if (missing.Length > 150) missing = missing.Substring(0, 150) + "…";

                // 分情形给结论：这是"只拷了 server/ 没拷仓库根"的典型指纹
                if (!paths.FromPackage && hasServerNM && !hasFarm)
                    r.Detail = "依赖树残缺（拷机拷坏了）：" + missing
                        + " —— pnpm 的依赖在仓库根的 node_modules/.pnpm 里，server/node_modules 只是软链接；"
                        + "只拷 server/ 就会这样。改在仓库根跑 pnpm install --frozen-lockfile，或直接用部署包里的 api/（自足、无软链接）。";
                else if (paths.FromPackage)
                    r.Detail = "部署包的 api/node_modules 不完整：" + missing
                        + " —— api/ 要整目录一起拷（含 node_modules），别只拿 api/src。";
                else
                    r.Detail = "有包解析不了：" + missing + " —— 在仓库根跑 pnpm install --frozen-lockfile 补齐。";
                return r;
            }
            catch (Exception ex)
            {
                r.Detail = "依赖探测没跑起来：" + ex.Message;
                return r;
            }
        }

        // 只有取 Node 版本这一件事走这里，所以运行时解析复用 NodeStartInfo：
        // 随带运行时不导出 ELECTRON_RUN_AS_NODE 的话，它不会报版本，而是把安装器
        // 界面再开一个窗口出来。
        string NodeCapture(string arg)
        {
            try
            {
                ProcessStartInfo psi = NodeStartInfo(arg);
                // NodeStartInfo 为重定向准备，这里只读 stdout：留着 stderr 没人读，
                // 子进程一写满管道就再也不退出，5 秒后只会得到一句"取版本失败"。
                psi.RedirectStandardError = false;
                using (Process p = Process.Start(psi))
                {
                    string o = p.StandardOutput.ReadToEnd();
                    p.WaitForExit(5000);
                    return o.Trim();
                }
            }
            catch (Exception ex) { return "取版本失败：" + ex.Message; }
        }

        bool PortReady(out int port, out string host)
        {
            port = 0;
            host = (hostBox.Text ?? string.Empty).Trim();
            if (host.Length == 0) host = "127.0.0.1";
            string raw = (portBox.Text ?? string.Empty).Trim();
            if (raw.Length == 0) return false;
            if (!int.TryParse(raw, out port)) return false;
            return port >= 1 && port <= 65535;
        }

        static bool PortFree(int port)
        {
            TcpListener l = null;
            try
            {
                l = new TcpListener(IPAddress.Loopback, port);
                l.Start();
                return true;
            }
            catch (Exception)
            {
                return false;
            }
            finally
            {
                if (l != null) { try { l.Stop(); } catch (Exception) { } }
            }
        }

        bool RequiredEnvReady()
        {
            foreach (EnvRow r in rows.Values)
                if (r.Required && r.State == 2) return false;
            return true;
        }

        // ---------------- 起停 ----------------
        void StartBackend()
        {
            if (backend != null && !backend.HasExited)
            {
                Log("[!] 后端已经在跑（PID " + backend.Id + "），先点「停止」再换端口。");
                return;
            }
            if (paths == null || !RequiredEnvReady())
            {
                Log("[✗] 环境体检还有必需项没通过，起不来。点缺失那行的「指引」按链接装好，再回来点「重新体检」。");
                return;
            }
            int port;
            string host;
            if (!PortReady(out port, out host))
            {
                Log("[✗] 端口没填或不在 1–65535 之内。端口每次手动启动都得重填一遍，这是刻意的：别让一个记熟的号悄悄占住别的程序在用的口。");
                portBox.Focus();
                return;
            }
            if (!PortFree(port))
            {
                // 起了也是白起：node 会立刻 EADDRINUSE 退出，看起来像"仪表盘坏了"。
                // 多半是上一次选了"留着继续跑"，或同机还有第二个实例。
                Log(string.Format(
                    "[✗] 端口 {0} 已经被占用，没有再起一个。若是刚才选了「留着继续跑」，那站点还活着——直接用浏览器开 {1} 就是它；"
                    + "要换端口就填一个别的，或先「停止」再起。", port, SiteUrl(port, host)));
                return;
            }
            if (SchemeIsHttps && TlsAtBackend && !File.Exists(TlsPfxPath))
            {
                // 这条必须拦：放过去就是"操作员以为加密了、其实站点起成了明文"。
                Log("[✗] 选了 HTTPS + 本机后端持证书，但证书包不在：" + TlsPfxPath);
                Log("    三条出路：点「生成本机自签证书」；把已有 pfx 的路径填进证书框；或改选「前置 Nginx」/退回 HTTP。");
                Log("    这里不会悄悄按明文起站——那样看起来成功了，实际链路没加密。");
                return;
            }

            try
            {
                ProcessStartInfo psi = NodeStartInfo("src/index.js");
                psi.WorkingDirectory = paths.ServerDir;
                // node 重定向到管道时按 UTF-8 写；.NET 默认用本机 OEM 码页（简体中文＝936）去解，
                // 于是"辨妄阁 API 已启动"这类中文行在日志框里全变成繁体乱码。显式声明 UTF-8 才对。
                psi.StandardOutputEncoding = new System.Text.UTF8Encoding(false);
                psi.StandardErrorEncoding = new System.Text.UTF8Encoding(false);
                psi.CreateNoWindow = true;
                psi.EnvironmentVariables["BW_PORT"] = port.ToString();
                psi.EnvironmentVariables["BW_HOST"] = host;
                psi.EnvironmentVariables["BW_CRED_FILE"] = "1";
                if (SchemeIsHttps && TlsAtBackend)
                {
                    psi.EnvironmentVariables["BW_TLS_PFX"] = TlsPfxPath;
                    string pass = CfgValue("tls_pfx_pass", "");
                    if (pass.Length > 0) psi.EnvironmentVariables["BW_TLS_PFX_PASS"] = pass;
                }
                if (string.IsNullOrEmpty(psi.EnvironmentVariables["NODE_ENV"]))
                    psi.EnvironmentVariables["NODE_ENV"] = "production";

                backend = Process.Start(psi);
                backend.OutputDataReceived += delegate(object s, DataReceivedEventArgs e) { if (e.Data != null) Log(e.Data); };
                backend.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) { if (e.Data != null) Log(e.Data); };
                backend.BeginOutputReadLine();
                backend.BeginErrorReadLine();
                backend.Exited += delegate { OnBackendExited(); };

                WriteRememberedPort(port);
                lastPort = port;
                string url = SiteUrl(port, host);
                stateLabel.Text = "运行中 · " + url.TrimEnd('/') + " · PID " + backend.Id;
                stateLabel.ForeColor = SignalInk;
                Log(string.Format("[✓] 已起：{0}   （默认登录 admin/admin，上线第一件事是改密）", url));
                if (SchemeIsHttps && !TlsAtBackend)
                {
                    Log("[i] 本次协议：HTTPS 由**前置 Nginx** 终结——node 仍按明文 HTTP 监听 "
                        + host + ":" + port + "（这是对的，只监听回环），加密与 443 由 Nginx 负责，配置见 nginx\\bianwang.conf。");
                    Log("[i] 本程序不校验 Nginx 是否已经装好、证书是否有效；地址打不开先查那两头。");
                }
                else if (SchemeIsHttps)
                {
                    Log("[i] 本次协议：node 直接以 TLS 监听（证书 " + TlsPfxPath + "）。自签证书浏览器会先告警，属预期。");
                }
                else
                {
                    Log("[i] 本次协议：明文 HTTP（默认档）。口令与正文在链路上是可读的，别把这个端口朝公网开放。");
                }
                SyncButtonStates();
            }
            catch (Exception ex)
            {
                backend = null;
                Log("[✗] 起不来：" + ex.Message);
                SyncButtonStates();
            }
        }

        void OnBackendExited()
        {
            if (IsDisposed) return;
            try
            {
                BeginInvoke(new Action(delegate
                {
                    stateLabel.Text = "未运行";
                    stateLabel.ForeColor = InkMute;
                    Log("[ ] 后端进程已结束。");
                    backend = null;
                    SyncButtonStates();
                }));
            }
            catch (Exception) { }
        }

        void StopBackend()
        {
            if (backend == null) return;
            try
            {
                if (!backend.HasExited)
                {
                    // 无控制台的子进程收不到 Ctrl+C，只能等它自己退，超时再连子树一起结束
                    if (!backend.WaitForExit(2500)) KillTree(backend);
                }
            }
            catch (Exception ex)
            {
                Log("[!] 温和退出没成，强制结束：" + ex.Message);
                try { if (backend != null) KillTree(backend); } catch (Exception) { }
            }
            backend = null;
            stateLabel.Text = "未运行";
            stateLabel.ForeColor = InkMute;
            SyncButtonStates();
        }

        static void KillTree(Process p)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("taskkill.exe", "/T /F /PID " + p.Id);
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                using (Process k = Process.Start(psi)) { k.WaitForExit(5000); }
            }
            catch (Exception)
            {
                try { p.Kill(); } catch (Exception) { }
            }
        }

        void OpenSite()
        {
            int port;
            string host;
            if (!PortReady(out port, out host)) return;
            OpenUrl(SiteUrl(port, host));
        }

        static void OpenUrl(string url)
        {
            if (string.IsNullOrEmpty(url)) return;
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(url);
                psi.UseShellExecute = true;
                Process.Start(psi);
            }
            catch (Exception ex)
            {
                MessageBox.Show("浏览器没调起来，可以手动访问：\n" + url + "\n\n" + ex.Message,
                    "辨妄阁", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        }

        // ---------------- 项目本地步骤（只动站点自己，不动系统） ----------------
        void RunStep(string label, string kind, Action<bool> done)
        {
            Log("[>] 开始：" + label);
            SyncButtonStates();
            ThreadPool.QueueUserWorkItem(delegate
            {
                bool ok = false;
                try
                {
                    ProcessStartInfo psi;
                    if (kind == "seed")
                    {
                        // 相对 ServerDir 而非 Root：仓库里是 server\scripts\reseed.js，
                        // 部署包与离线包里是 api\scripts\reseed.js，同一段代码要两种布局都成立。
                        // 离线包那台机器上通常没有 node.exe，所以走统一入口。
                        psi = NodeStartInfo("scripts/reseed.js");
                        psi.WorkingDirectory = paths.ServerDir;
                    }
                    else
                    {
                        psi = new ProcessStartInfo();
                        psi.FileName = "cmd.exe";
                        psi.Arguments = "/c pnpm " + kind;
                        psi.UseShellExecute = false;
                        psi.RedirectStandardOutput = true;
                        psi.RedirectStandardError = true;
                        psi.CreateNoWindow = true;
                        psi.WorkingDirectory = paths.Root;
                    }
                    using (Process p = Process.Start(psi))
                    {
                        string outp = p.StandardOutput.ReadToEnd();
                        string err = p.StandardError.ReadToEnd();
                        p.WaitForExit();
                        ok = p.ExitCode == 0;
                        if (outp.Length > 0) LogLines(outp);
                        if (err.Length > 0) LogLines(err);
                        Log((ok ? "[✓] " : "[✗] ") + label + (ok ? " 完成。" : " 失败（退出码 " + p.ExitCode + "）。"));
                    }
                }
                catch (Exception ex)
                {
                    ok = false;
                    Log("[✗] " + label + " 跑不起来：" + ex.Message);
                }
                if (done != null) done(ok);
                else BeginInvoke(new Action(delegate { RefreshEnv(); SyncButtonStates(); }));
            });
        }

        void LogLines(string blob)
        {
            string[] parts = blob.Replace("\r\n", "\n").Split('\n');
            for (int i = 0; i < parts.Length; i++)
                if (parts[i].Trim().Length > 0) Log(parts[i]);
        }

        // ---------------- 开机自启 ----------------
        void SyncAutostartCheckbox()
        {
            autostartWritebackSuppressed = true;
            try { autostartCheck.Checked = AutostartEnabled(); }
            finally { autostartWritebackSuppressed = false; }
        }

        static bool AutostartEnabled()
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(RunKeyPath, false))
                {
                    if (key == null) return false;
                    object v = key.GetValue(RunValueName);
                    return v != null && v.ToString().Length > 0;
                }
            }
            catch (Exception) { return false; }
        }

        void OnAutostartToggled(object sender, EventArgs e)
        {
            if (autostartWritebackSuppressed) return;
            bool want = autostartCheck.Checked;
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(RunKeyPath, true))
                {
                    if (key == null) throw new Exception("拿不到当前用户的启动项注册表键");
                    if (want)
                    {
                        string probeHost;
                        int typedPort;
                        bool filled = PortReady(out typedPort, out probeHost);
                        // 勾自启那一刻必须有明确端口：刚填过的优先，否则沿用确认过的
                        int port = filled ? typedPort : ReadRememberedPort();
                        if (port <= 0)
                        {
                            autostartWritebackSuppressed = true;
                            autostartCheck.Checked = false;
                            autostartWritebackSuppressed = false;
                            Log("[✗] 没填端口，也就没法开机自启——自启用的是你确认过的那个端口。");
                            return;
                        }
                        key.SetValue(RunValueName, "\"" + Application.ExecutablePath + "\" --autostart");
                        WriteRememberedPort(port);
                        lastPort = port;
                        Log(string.Format("[✓] 已登记开机自启：登录后自动用端口 {0} 起站（要改端口，改完再点一次「启动」即可更新）。", port));
                    }
                    else
                    {
                        key.DeleteValue(RunValueName, false);
                        Log("[✓] 已取消开机自启（只是撤了启动项，程序还在）。");
                    }
                }
            }
            catch (Exception ex)
            {
                autostartWritebackSuppressed = true;
                autostartCheck.Checked = AutostartEnabled();
                autostartWritebackSuppressed = false;
                Log("[✗] 自启设置没写成：" + ex.Message);
            }
        }

        // ---------------- 状态同步与收尾 ----------------
        void SyncButtonStates()
        {
            bool running = backend != null && !backend.HasExited;
            int probePort;
            string probeHost;
            bool portFilled = PortReady(out probePort, out probeHost);
            startButton.Enabled = !running && RequiredEnvReady() && portFilled;
            stopButton.Enabled = running;
            openButton.Enabled = running;
            recheckButton.Enabled = !running;
            portBox.Enabled = !running;
            hostBox.Enabled = !running;
            // 协议不能中途换：换了界面显示 https 而进程还在明文听，比不给开关更糟。锁住并写明要重启。
            httpRadio.Enabled = !running;
            httpsRadio.Enabled = !running;
            if (tlsNodeRadio != null) tlsNodeRadio.Enabled = !running;
            if (tlsProxyRadio != null) tlsProxyRadio.Enabled = !running;
            if (pfxBox != null) pfxBox.Enabled = !running;
            if (certButton != null) certButton.Enabled = !running;
            startButton.Text = running ? "运行中" : "启动站点";
        }

        void OnFormClosing(object sender, FormClosingEventArgs e)
        {
            if (backend != null && !backend.HasExited)
            {
                DialogResult r = MessageBox.Show(
                    "后端还在跑。关掉仪表盘会把它一起停掉——确定吗？\n\n" +
                    "想让它继续跑，点「留着继续跑」，仪表盘退出但站点不动。",
                    "辨妄阁", MessageBoxButtons.YesNoCancel, MessageBoxIcon.Question,
                    MessageBoxDefaultButton.Button2);
                if (r == DialogResult.Cancel) { e.Cancel = true; return; }
                if (r == DialogResult.No) { backend.EnableRaisingEvents = false; backend = null; return; }
                StopBackend();
            }
        }

        void Log(string line)
        {
            if (logBox == null || logBox.IsDisposed) return;
            if (logBox.InvokeRequired)
            {
                try { logBox.BeginInvoke(new Action<string>(AppendLog), line); }
                catch (Exception) { }
                return;
            }
            AppendLog(line);
        }

        void AppendLog(string line)
        {
            logBox.AppendText(DateTime.Now.ToString("HH:mm:ss") + "  " + line + Environment.NewLine);
            logBox.SelectionStart = logBox.TextLength;
            logBox.ScrollToCaret();
        }
    }

    internal static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            bool autostart = false;
            for (int i = 0; i < args.Length; i++)
                if (string.Equals(args[i], "--autostart", StringComparison.OrdinalIgnoreCase)) autostart = true;

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm(autostart));
        }
    }
}
