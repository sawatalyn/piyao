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
                                FromPackage = false
                            };
                        }
                        if (File.Exists(Path.Combine(pkgApi, "src", "index.js")))
                        {
                            return new Paths
                            {
                                Root = dir.FullName,
                                ServerDir = pkgApi,
                                WebDistIndex = Path.Combine(dir.FullName, "web", "dist", "index.html"),
                                FromPackage = true
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

        public MainForm(bool autostart)
        {
            autostartArg = autostart;
            paths = Paths.Locate();
            configDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), AppDir);
            configFile = Path.Combine(configDir, "dashboard.cfg");
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

        // ---------------- 配置 ----------------
        int ReadRememberedPort()
        {
            try
            {
                string[] lines = File.ReadAllLines(configFile);
                for (int i = 0; i < lines.Length; i++)
                {
                    if (lines[i].StartsWith("port="))
                    {
                        int v;
                        if (int.TryParse(lines[i].Substring(5).Trim(), out v) && v >= 1 && v <= 65535) return v;
                    }
                }
            }
            catch (Exception) { }
            return -1;
        }

        void WriteRememberedPort(int port)
        {
            try
            {
                Directory.CreateDirectory(configDir);
                File.WriteAllText(configFile, "port=" + port + Environment.NewLine);
            }
            catch (Exception ex)
            {
                Log("[!] 端口配置写不进去（不影响本次运行）：" + ex.Message);
            }
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
            ClientSize = new Size(716, 700);
            MinimumSize = new Size(690, 640);
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

            // —— 端口区：需求 1 ——
            GroupBox portPane = new GroupBox();
            portPane.Text = "运行端口（每次手动启动都要填）";
            portPane.Dock = DockStyle.Fill;
            portPane.Height = 132;
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
            hostHint.Text = "默认只监听回环，交给 Nginx 反代；改成 0.0.0.0 会直接对全网开放";
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

            autostartCheck = new CheckBox();
            autostartCheck.Text = "登录 Windows 后自动起站（沿用上次端口，开机不再问）";
            autostartCheck.AutoSize = true;
            autostartCheck.ForeColor = InkSoft;
            autostartCheck.Location = new Point(14, 103);
            autostartCheck.CheckedChanged += OnAutostartToggled;
            portPane.Controls.Add(autostartCheck);
            SyncAutostartCheckbox();

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
            envPanel.Size = new Size(676, 240);
            envPanel.AutoScroll = true;
            // 默认是 LeftToRight：不改成 TopDown，六行体检会横着排成一条，只剩第一行可见
            envPanel.FlowDirection = FlowDirection.TopDown;
            envPanel.WrapContents = false;
            envPanel.BackColor = TerraField;
            envPanel.BorderStyle = BorderStyle.None;
            envPane.Controls.Add(envPanel);
            envPane.Height = 310;

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
            EnvRow nodeRow = new EnvRow
            {
                Name = "Node.js",
                Detail = node == null ? "没装（站点后端要 >= 20.19.0）"
                    : node.ToString() + (nodeOk ? "，满足 >= 20.19.0" : "，低于要求的 20.19.0"),
                State = node == null ? 2 : (nodeOk ? 0 : 1),
                Required = true,
                ActionLabel = node == null ? "" : "版本明细",
                HelpUrl = "https://nodejs.org/zh-cn/download"
            };
            if (node != null)
                nodeRow.Action = delegate { Log("[Node] " + RunCapture("node.exe", "-v")); };
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

            Log("[体检] Node=" + (node == null ? "缺失" : node.ToString())
                + " · pnpm=" + (pnpmVer == null ? "缺失" : pnpmVer)
                + " · 依赖=" + (depsOk ? "有" : "无")
                + " · dist=" + (distOk ? "有" : "无")
                + " · 数据=" + (dataOk ? "有" : "无"));
            SyncButtonStates();
            envPanel.ResumeLayout();
        }

        static Version ProbeNode()
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("node.exe", "-v");
                psi.UseShellExecute = false;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                psi.CreateNoWindow = true;
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
                    ProcessStartInfo psi = new ProcessStartInfo("node.exe", "\"" + scriptPath + "\"");
                    psi.WorkingDirectory = paths.ServerDir;
                    psi.UseShellExecute = false;
                    psi.RedirectStandardOutput = true;
                    psi.RedirectStandardError = true;
                    psi.CreateNoWindow = true;
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

        static string RunCapture(string exe, string arg)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(exe, arg);
                psi.UseShellExecute = false;
                psi.RedirectStandardOutput = true;
                psi.CreateNoWindow = true;
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
                    "[✗] 端口 {0} 已经被占用，没有再起一个。若是刚才选了「留着继续跑」，那站点还活着——直接用浏览器开 http://{1}:{0} 就是它；"
                    + "要换端口就填一个别的，或先「停止」再起。", port, host));
                return;
            }

            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = "node.exe";
                psi.Arguments = "src/index.js";
                psi.WorkingDirectory = paths.ServerDir;
                psi.UseShellExecute = false;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                psi.CreateNoWindow = true;
                psi.EnvironmentVariables["BW_PORT"] = port.ToString();
                psi.EnvironmentVariables["BW_HOST"] = host;
                psi.EnvironmentVariables["BW_CRED_FILE"] = "1";
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
                stateLabel.Text = "运行中 · http://" + host + ":" + port + " · PID " + backend.Id;
                stateLabel.ForeColor = SignalInk;
                Log(string.Format("[✓] 已起：http://{0}:{1}   （默认登录 admin/admin，上线第一件事是改密）", host, port));
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
            OpenUrl("http://" + host + ":" + port + "/");
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
                    ProcessStartInfo psi = new ProcessStartInfo();
                    psi.UseShellExecute = false;
                    psi.RedirectStandardOutput = true;
                    psi.RedirectStandardError = true;
                    psi.CreateNoWindow = true;
                    psi.WorkingDirectory = paths.Root;
                    if (kind == "seed")
                    {
                        psi.FileName = "node.exe";
                        psi.Arguments = "server/scripts/reseed.js";
                        psi.WorkingDirectory = paths.Root;
                    }
                    else
                    {
                        psi.FileName = "cmd.exe";
                        psi.Arguments = "/c pnpm " + kind;
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
