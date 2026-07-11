using System;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Windows.Forms;

#region 飞行日志数据模型
public class FlightLogData
{
    public string FlightNumber { get; set; } = "";
    public string AircraftType { get; set; } = "";
    public string Registration { get; set; } = "";
    public int Year { get; set; }
    public int Month { get; set; } = 1;
    public int Day { get; set; } = 1;
    public string DepartureAirport { get; set; } = "";
    public string DepartureGate { get; set; } = "";
    public int DepartureHour { get; set; }
    public int DepartureMinute { get; set; }
    public string DepartureWeather { get; set; } = "";
    public string FlightPlan { get; set; } = "";

    public string V1 { get; set; } = "";
    public string VR { get; set; } = "";
    public string V2 { get; set; } = "";
    public string TakeoffConfig { get; set; } = "";
    public string TakeoffRunway { get; set; } = "";

    public string CruiseRemark { get; set; } = "";
    public bool CruiseRemarkNone { get; set; }

    public string ArrivalAirport { get; set; } = "";
    public string LandingRunway { get; set; } = "";
    public string LandingMethod { get; set; } = "";
    public string LandingConfig { get; set; } = "";
    public string LandingWeather { get; set; } = "";
    public int LandingHour { get; set; }
    public int LandingMinute { get; set; }
    public string ArrivalGate { get; set; } = "";

    public string PostFlightRemark { get; set; } = "";
    public bool PostFlightRemarkNone { get; set; }
}
#endregion

#region 主窗体
public class MainForm : Form
{
    private TabControl tabControl;
    private TabPage tabLoad;
    private TabPage tabCreate;
    private ControlSet createControls;
    private ControlSet loadControls;

    public MainForm()
    {
        this.Text = "AXZ 飞行日志记录器";
        this.Size = new Size(900, 700);
        this.StartPosition = FormStartPosition.CenterScreen;
        this.MinimumSize = new Size(800, 600);

        tabControl = new TabControl { Dock = DockStyle.Fill };
        tabLoad = new TabPage("载入飞行日志");
        tabCreate = new TabPage("生成飞行日志文件");
        tabControl.TabPages.Add(tabLoad);
        tabControl.TabPages.Add(tabCreate);
        tabControl.SelectedTab = tabLoad;

        var lblWatermark = new Label
        {
            Text = "由小泽制作，AXZ内部专用",
            ForeColor = Color.Gray,
            Font = new Font("Microsoft YaHei", 8),
            AutoSize = false,
            TextAlign = ContentAlignment.BottomRight,
            Dock = DockStyle.Bottom,
            Height = 25,
            Padding = new Padding(0, 0, 10, 3)
        };

        createControls = BuildFlightLogPanel(false);
        loadControls = BuildFlightLogPanel(true);

        // 载入页布局
        var btnLoad = new Button { Text = "选择文件", AutoSize = true, Margin = new Padding(5) };
        btnLoad.Click += BtnLoad_Click;
        var loadPanel = new Panel { Dock = DockStyle.Fill, AutoScroll = true };
        var loadLayout = new TableLayoutPanel { ColumnCount = 1, RowCount = 2, Dock = DockStyle.Fill };
        loadLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 40));
        loadLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        var btnPanel = new FlowLayoutPanel { FlowDirection = FlowDirection.LeftToRight, Margin = new Padding(5) };
        btnPanel.Controls.Add(btnLoad);
        loadLayout.Controls.Add(btnPanel, 0, 0);
        loadControls.ParentPanel!.Dock = DockStyle.Fill;
        loadLayout.Controls.Add(loadControls.ParentPanel, 0, 1);
        loadPanel.Controls.Add(loadLayout);
        tabLoad.Controls.Add(loadPanel);

        // 生成页布局
        var btnSave = new Button { Text = "保存飞行日志", AutoSize = true, Margin = new Padding(5) };
        btnSave.Click += BtnSave_Click;
        var createPanel = new Panel { Dock = DockStyle.Fill, AutoScroll = true };
        var createLayout = new TableLayoutPanel { ColumnCount = 1, RowCount = 2, Dock = DockStyle.Fill };
        createLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        createLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 45));
        createControls.ParentPanel!.Dock = DockStyle.Fill;
        createLayout.Controls.Add(createControls.ParentPanel, 0, 0);
        var saveBtnPanel = new FlowLayoutPanel { FlowDirection = FlowDirection.LeftToRight, Margin = new Padding(5), Dock = DockStyle.Bottom };
        saveBtnPanel.Controls.Add(btnSave);
        createLayout.Controls.Add(saveBtnPanel, 0, 1);
        createPanel.Controls.Add(createLayout);
        tabCreate.Controls.Add(createPanel);

        var mainLayout = new TableLayoutPanel { ColumnCount = 1, RowCount = 2, Dock = DockStyle.Fill };
        mainLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        mainLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 25));
        mainLayout.Controls.Add(tabControl, 0, 0);
        mainLayout.Controls.Add(lblWatermark, 0, 1);
        this.Controls.Add(mainLayout);
    }

    private ControlSet BuildFlightLogPanel(bool readOnly)
    {
        var panel = new TableLayoutPanel
        {
            AutoSize = true,
            ColumnCount = 4,
            RowCount = 0,
            Padding = new Padding(10),
            AutoScroll = false,
            Dock = DockStyle.Top
        };
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 90));
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 40));
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 90));
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 40));

        var ctrl = new ControlSet();
        ctrl.ParentPanel = panel;

        int row = 0;

        // 辅助：添加标签
        void AddLabel(string text, int col, int r)
        {
            panel.Controls.Add(new Label { Text = text, Anchor = AnchorStyles.Right, AutoSize = true, Margin = new Padding(3) }, col, r);
        }

        // 飞行前
        AddSectionHeader(panel, "飞行前", ref row);

        AddLabel("航班号：", 0, row);
        ctrl.FlightNumber = AddTextBox(panel, 1, row, readOnly, "");
        AddLabel("机型：", 2, row);
        ctrl.AircraftType = AddTextBox(panel, 3, row, readOnly, "");
        row++;

        AddLabel("注册号：", 0, row);
        ctrl.Registration = AddTextBox(panel, 1, row, readOnly, "");
        AddLabel("日期：", 2, row);
        var datePanel = new FlowLayoutPanel { FlowDirection = FlowDirection.LeftToRight, AutoSize = true, Margin = new Padding(0) };
        // 正确地将标签添加到 datePanel 内
        ctrl.Year = AddNumeric(datePanel, 2024, 1900, 2100, readOnly);
        datePanel.Controls.Add(new Label { Text = "年", AutoSize = true, Margin = new Padding(0) });
        ctrl.Month = AddNumeric(datePanel, 1, 1, 12, readOnly);
        datePanel.Controls.Add(new Label { Text = "月", AutoSize = true, Margin = new Padding(0) });
        ctrl.Day = AddNumeric(datePanel, 1, 1, 31, readOnly);
        datePanel.Controls.Add(new Label { Text = "日", AutoSize = true, Margin = new Padding(0) });
        panel.Controls.Add(datePanel, 3, row);
        row++;

        AddLabel("起飞机场：", 0, row);
        ctrl.DepartureAirport = AddTextBox(panel, 1, row, readOnly, "", maxLength: 4);
        AddLabel("停机位：", 2, row);
        ctrl.DepartureGate = AddTextBox(panel, 3, row, readOnly, "");
        row++;

        AddLabel("时间(起飞)：", 0, row);
        var depTimePanel = new FlowLayoutPanel { FlowDirection = FlowDirection.LeftToRight, AutoSize = true };
        ctrl.DepartureHour = AddNumeric(depTimePanel, 0, 0, 23, readOnly);
        depTimePanel.Controls.Add(new Label { Text = "时", AutoSize = true, Margin = new Padding(0) });
        ctrl.DepartureMinute = AddNumeric(depTimePanel, 0, 0, 59, readOnly);
        depTimePanel.Controls.Add(new Label { Text = "分", AutoSize = true, Margin = new Padding(0) });
        panel.Controls.Add(depTimePanel, 1, row);

        AddLabel("机场天气：", 2, row);
        ctrl.DepartureWeather = AddTextBox(panel, 3, row, readOnly, "");
        row++;

        AddLabel("飞行计划：", 0, row);
        ctrl.FlightPlan = AddTextBox(panel, 1, row, readOnly, "");
        panel.SetColumnSpan(panel.Controls[^1], 3);
        row++;

        // 起飞
        AddSectionHeader(panel, "起飞", ref row);

        AddLabel("V1：", 0, row);
        ctrl.V1 = AddTextBox(panel, 1, row, readOnly, "");
        AddLabel("VR：", 2, row);
        ctrl.VR = AddTextBox(panel, 3, row, readOnly, "");
        row++;

        AddLabel("V2：", 0, row);
        ctrl.V2 = AddTextBox(panel, 1, row, readOnly, "");
        AddLabel("构型：", 2, row);
        ctrl.TakeoffConfig = AddTextBox(panel, 3, row, readOnly, "");
        row++;

        AddLabel("跑道：", 0, row);
        ctrl.TakeoffRunway = AddTextBox(panel, 1, row, readOnly, "");
        panel.SetColumnSpan(panel.Controls[^1], 3);
        row++;

        // 巡航
        AddSectionHeader(panel, "巡航", ref row);

        AddLabel("备注：", 0, row);
        ctrl.CruiseRemark = AddTextBox(panel, 1, row, readOnly, "");
        ctrl.CruiseRemarkNone = new CheckBox { Text = "无", AutoSize = true };
        if (readOnly) ctrl.CruiseRemarkNone.Enabled = false;
        ctrl.CruiseRemarkNone.CheckedChanged += (s, e) =>
        {
            ctrl.CruiseRemark!.Enabled = !ctrl.CruiseRemarkNone!.Checked;
            if (ctrl.CruiseRemarkNone.Checked) ctrl.CruiseRemark.Text = "";
        };
        var cruiseCheckPanel = new FlowLayoutPanel { FlowDirection = FlowDirection.LeftToRight, AutoSize = true };
        cruiseCheckPanel.Controls.Add(ctrl.CruiseRemarkNone);
        panel.Controls.Add(cruiseCheckPanel, 3, row);
        row++;

        // 降落
        AddSectionHeader(panel, "降落", ref row);

        AddLabel("降落机场：", 0, row);
        ctrl.ArrivalAirport = AddTextBox(panel, 1, row, readOnly, "");
        AddLabel("跑道：", 2, row);
        ctrl.LandingRunway = AddTextBox(panel, 3, row, readOnly, "");
        row++;

        AddLabel("降落方式：", 0, row);
        if (readOnly)
        {
            // 只读时使用文本框显示，清晰且不灰
            ctrl.LandingMethodTextBox = AddTextBox(panel, 1, row, true, "");
            ctrl.LandingMethod = null;
        }
        else
        {
            ctrl.LandingMethod = new ComboBox
            {
                DropDownStyle = ComboBoxStyle.DropDownList,
                Items = { "CAT I", "CAT II", "CAT III", "VOR", "NDB", "LOC", "GLS", "RNAV/RNP", "目视" }
            };
            ctrl.LandingMethod.SelectedIndex = -1;
            panel.Controls.Add(ctrl.LandingMethod, 1, row);
        }
        AddLabel("构型：", 2, row);
        ctrl.LandingConfig = AddTextBox(panel, 3, row, readOnly, "");
        row++;

        AddLabel("天气：", 0, row);
        ctrl.LandingWeather = AddTextBox(panel, 1, row, readOnly, "");
        AddLabel("时间(降落)：", 2, row);
        var arrTimePanel = new FlowLayoutPanel { FlowDirection = FlowDirection.LeftToRight, AutoSize = true };
        ctrl.LandingHour = AddNumeric(arrTimePanel, 0, 0, 23, readOnly);
        arrTimePanel.Controls.Add(new Label { Text = "时", AutoSize = true, Margin = new Padding(0) });
        ctrl.LandingMinute = AddNumeric(arrTimePanel, 0, 0, 59, readOnly);
        arrTimePanel.Controls.Add(new Label { Text = "分", AutoSize = true, Margin = new Padding(0) });
        panel.Controls.Add(arrTimePanel, 3, row);
        row++;

        AddLabel("停机位：", 0, row);
        ctrl.ArrivalGate = AddTextBox(panel, 1, row, readOnly, "");
        panel.SetColumnSpan(panel.Controls[^1], 3);
        row++;

        // 飞行后
        AddSectionHeader(panel, "飞行后", ref row);

        AddLabel("备注：", 0, row);
        ctrl.PostFlightRemark = AddTextBox(panel, 1, row, readOnly, "");
        ctrl.PostFlightRemarkNone = new CheckBox { Text = "无", AutoSize = true };
        if (readOnly) ctrl.PostFlightRemarkNone.Enabled = false;
        ctrl.PostFlightRemarkNone.CheckedChanged += (s, e) =>
        {
            ctrl.PostFlightRemark!.Enabled = !ctrl.PostFlightRemarkNone!.Checked;
            if (ctrl.PostFlightRemarkNone.Checked) ctrl.PostFlightRemark.Text = "";
        };
        var postCheckPanel = new FlowLayoutPanel { FlowDirection = FlowDirection.LeftToRight, AutoSize = true };
        postCheckPanel.Controls.Add(ctrl.PostFlightRemarkNone);
        panel.Controls.Add(postCheckPanel, 3, row);
        row++;

        // 只读样式优化
        if (readOnly)
        {
            foreach (Control c in panel.Controls)
            {
                if (c is TextBox tb)
                {
                    tb.ReadOnly = true;
                    tb.BackColor = SystemColors.Window;   // 白色背景，文字清晰
                    tb.ForeColor = SystemColors.WindowText;
                }
                else if (c is NumericUpDown nud)
                {
                    nud.ReadOnly = true;    // .NET 6+ 支持，不会变灰
                }
                // ComboBox 已在只读时替换为 TextBox，无需处理
            }
        }

        // 起飞机场自动转大写（仅生成页）
        if (!readOnly)
        {
            ctrl.DepartureAirport!.TextChanged += (s, e) =>
            {
                var tb = (TextBox)s!;
                int sel = tb.SelectionStart;
                tb.Text = tb.Text.ToUpperInvariant();
                tb.SelectionStart = sel;
            };
        }

        return ctrl;
    }

    private void AddSectionHeader(TableLayoutPanel panel, string title, ref int row)
    {
        var lbl = new Label
        {
            Text = title,
            Font = new Font("Microsoft YaHei", 10, FontStyle.Bold),
            AutoSize = true,
            Margin = new Padding(3, 8, 3, 2)
        };
        panel.Controls.Add(lbl, 0, row);
        panel.SetColumnSpan(lbl, 4);
        row++;
    }

    private TextBox AddTextBox(TableLayoutPanel panel, int col, int row, bool readOnly, string defaultText, int? maxLength = null)
    {
        var tb = new TextBox
        {
            Text = defaultText,
            Dock = DockStyle.Fill,
            ReadOnly = readOnly
        };
        if (readOnly)
        {
            tb.BackColor = SystemColors.Window;
            tb.ForeColor = SystemColors.WindowText;
        }
        if (maxLength.HasValue) tb.MaxLength = maxLength.Value;
        panel.Controls.Add(tb, col, row);
        return tb;
    }

    private NumericUpDown AddNumeric(Control parent, int value, int min, int max, bool readOnly)
    {
        var nud = new NumericUpDown
        {
            Minimum = min,
            Maximum = max,
            Value = value,
            Width = 55
        };
        if (readOnly)
        {
            nud.ReadOnly = true;   // .NET 6+
        }
        parent.Controls.Add(nud);
        return nud;
    }

    private FlightLogData CollectData()
    {
        var data = new FlightLogData();
        data.FlightNumber = createControls.FlightNumber!.Text.Trim();
        data.AircraftType = createControls.AircraftType!.Text.Trim();
        data.Registration = createControls.Registration!.Text.Trim();
        data.Year = (int)createControls.Year!.Value;
        data.Month = (int)createControls.Month!.Value;
        data.Day = (int)createControls.Day!.Value;
        data.DepartureAirport = createControls.DepartureAirport!.Text.Trim().ToUpperInvariant();
        data.DepartureGate = createControls.DepartureGate!.Text.Trim();
        data.DepartureHour = (int)createControls.DepartureHour!.Value;
        data.DepartureMinute = (int)createControls.DepartureMinute!.Value;
        data.DepartureWeather = createControls.DepartureWeather!.Text.Trim();
        data.FlightPlan = createControls.FlightPlan!.Text.Trim();

        data.V1 = createControls.V1!.Text.Trim();
        data.VR = createControls.VR!.Text.Trim();
        data.V2 = createControls.V2!.Text.Trim();
        data.TakeoffConfig = createControls.TakeoffConfig!.Text.Trim();
        data.TakeoffRunway = createControls.TakeoffRunway!.Text.Trim();

        data.CruiseRemark = createControls.CruiseRemark!.Text.Trim();
        data.CruiseRemarkNone = createControls.CruiseRemarkNone!.Checked;

        data.ArrivalAirport = createControls.ArrivalAirport!.Text.Trim();
        data.LandingRunway = createControls.LandingRunway!.Text.Trim();
        data.LandingMethod = createControls.LandingMethod?.SelectedItem?.ToString() ?? "";
        data.LandingConfig = createControls.LandingConfig!.Text.Trim();
        data.LandingWeather = createControls.LandingWeather!.Text.Trim();
        data.LandingHour = (int)createControls.LandingHour!.Value;
        data.LandingMinute = (int)createControls.LandingMinute!.Value;
        data.ArrivalGate = createControls.ArrivalGate!.Text.Trim();

        data.PostFlightRemark = createControls.PostFlightRemark!.Text.Trim();
        data.PostFlightRemarkNone = createControls.PostFlightRemarkNone!.Checked;

        return data;
    }

    private void FillLoadControls(FlightLogData data)
    {
        loadControls.FlightNumber!.Text = data.FlightNumber;
        loadControls.AircraftType!.Text = data.AircraftType;
        loadControls.Registration!.Text = data.Registration;
        loadControls.Year!.Value = data.Year;
        loadControls.Month!.Value = data.Month;
        loadControls.Day!.Value = data.Day;
        loadControls.DepartureAirport!.Text = data.DepartureAirport;
        loadControls.DepartureGate!.Text = data.DepartureGate;
        loadControls.DepartureHour!.Value = data.DepartureHour;
        loadControls.DepartureMinute!.Value = data.DepartureMinute;
        loadControls.DepartureWeather!.Text = data.DepartureWeather;
        loadControls.FlightPlan!.Text = data.FlightPlan;

        loadControls.V1!.Text = data.V1;
        loadControls.VR!.Text = data.VR;
        loadControls.V2!.Text = data.V2;
        loadControls.TakeoffConfig!.Text = data.TakeoffConfig;
        loadControls.TakeoffRunway!.Text = data.TakeoffRunway;

        loadControls.CruiseRemark!.Text = data.CruiseRemark;
        loadControls.CruiseRemarkNone!.Checked = data.CruiseRemarkNone;
        loadControls.CruiseRemark.Enabled = !data.CruiseRemarkNone;

        loadControls.ArrivalAirport!.Text = data.ArrivalAirport;
        loadControls.LandingRunway!.Text = data.LandingRunway;
        // 降落方式：只读模式使用的是 TextBox
        if (loadControls.LandingMethodTextBox != null)
            loadControls.LandingMethodTextBox.Text = data.LandingMethod;
        loadControls.LandingConfig!.Text = data.LandingConfig;
        loadControls.LandingWeather!.Text = data.LandingWeather;
        loadControls.LandingHour!.Value = data.LandingHour;
        loadControls.LandingMinute!.Value = data.LandingMinute;
        loadControls.ArrivalGate!.Text = data.ArrivalGate;

        loadControls.PostFlightRemark!.Text = data.PostFlightRemark;
        loadControls.PostFlightRemarkNone!.Checked = data.PostFlightRemarkNone;
        loadControls.PostFlightRemark.Enabled = !data.PostFlightRemarkNone;
    }

    private void BtnSave_Click(object? sender, EventArgs e)
    {
        var data = CollectData();
        using var sfd = new SaveFileDialog
        {
            Filter = "AXZ 飞行日志 (*.axzlog)|*.axzlog",
            DefaultExt = "axzlog",
            FileName = $"{data.FlightNumber}_{data.DepartureAirport}_{data.ArrivalAirport}.axzlog"
        };
        if (sfd.ShowDialog() != DialogResult.OK) return;

        try
        {
            string json = JsonSerializer.Serialize(data, new JsonSerializerOptions { WriteIndented = false });
            byte[] jsonBytes = Encoding.UTF8.GetBytes(json);

            using var fs = new FileStream(sfd.FileName, FileMode.Create);
            fs.Write(Encoding.ASCII.GetBytes("AXZLOG"), 0, 6);
            using var gz = new GZipStream(fs, CompressionLevel.Optimal);
            gz.Write(jsonBytes, 0, jsonBytes.Length);
            MessageBox.Show("飞行日志保存成功！", "提示", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception ex)
        {
            MessageBox.Show($"保存失败：{ex.Message}", "错误", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void BtnLoad_Click(object? sender, EventArgs e)
    {
        using var ofd = new OpenFileDialog
        {
            Filter = "AXZ 飞行日志 (*.axzlog)|*.axzlog",
            DefaultExt = "axzlog"
        };
        if (ofd.ShowDialog() != DialogResult.OK) return;

        try
        {
            byte[] fileBytes = File.ReadAllBytes(ofd.FileName);
            if (fileBytes.Length < 6 || Encoding.ASCII.GetString(fileBytes, 0, 6) != "AXZLOG")
            {
                MessageBox.Show("无效的日志文件格式。", "错误", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            using var ms = new MemoryStream(fileBytes, 6, fileBytes.Length - 6);
            using var gz = new GZipStream(ms, CompressionMode.Decompress);
            using var reader = new StreamReader(gz, Encoding.UTF8);
            string json = reader.ReadToEnd();
            var data = JsonSerializer.Deserialize<FlightLogData>(json);
            if (data == null) throw new Exception("数据为空");

            FillLoadControls(data);
            tabControl.SelectedTab = tabLoad;
        }
        catch (Exception ex)
        {
            MessageBox.Show($"载入失败：{ex.Message}", "错误", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
#endregion

#region 控件集合类（字段可为空，使用时均已保证非空）
public class ControlSet
{
    public Panel? ParentPanel { get; set; }
    public TextBox? FlightNumber { get; set; }
    public TextBox? AircraftType { get; set; }
    public TextBox? Registration { get; set; }
    public NumericUpDown? Year { get; set; }
    public NumericUpDown? Month { get; set; }
    public NumericUpDown? Day { get; set; }
    public TextBox? DepartureAirport { get; set; }
    public TextBox? DepartureGate { get; set; }
    public NumericUpDown? DepartureHour { get; set; }
    public NumericUpDown? DepartureMinute { get; set; }
    public TextBox? DepartureWeather { get; set; }
    public TextBox? FlightPlan { get; set; }
    public TextBox? V1 { get; set; }
    public TextBox? VR { get; set; }
    public TextBox? V2 { get; set; }
    public TextBox? TakeoffConfig { get; set; }
    public TextBox? TakeoffRunway { get; set; }
    public TextBox? CruiseRemark { get; set; }
    public CheckBox? CruiseRemarkNone { get; set; }
    public TextBox? ArrivalAirport { get; set; }
    public TextBox? LandingRunway { get; set; }
    public ComboBox? LandingMethod { get; set; }     // 仅生成页使用
    public TextBox? LandingMethodTextBox { get; set; } // 仅只读载入页使用
    public TextBox? LandingConfig { get; set; }
    public TextBox? LandingWeather { get; set; }
    public NumericUpDown? LandingHour { get; set; }
    public NumericUpDown? LandingMinute { get; set; }
    public TextBox? ArrivalGate { get; set; }
    public TextBox? PostFlightRemark { get; set; }
    public CheckBox? PostFlightRemarkNone { get; set; }
}
#endregion

#region 程序入口
static class Program
{
    [STAThread]
    static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new MainForm());
    }
}
#endregion