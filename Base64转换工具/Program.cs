using System;
using System.Drawing;
using System.IO;
using System.Text;
using System.Windows.Forms;

public class MainForm : Form
{
    private TabControl tabControl;
    private TabPage tabEncode;
    private TabPage tabDecode;

    private Panel encodeDropPanel;
    private CheckBox chkEncodeTextMode;
    private TextBox encodeInputBox;
    private Button btnEncode;
    private TextBox encodeResultBox;

    private Panel decodeDropPanel;
    private TextBox decodeInputBox;
    private Button btnDecode;
    private Button btnSaveDecoded;

    private string? currentEncodeFile = null;
    private string? currentDecodeFile = null;
    private byte[]? decodedData = null;
    private string decodedFileName = "";  // 初始为非空字符串

    public MainForm()
    {
        this.Text = "Base64 转换工具";
        this.Size = new Size(420, 450);
        this.StartPosition = FormStartPosition.CenterScreen;
        this.FormBorderStyle = FormBorderStyle.FixedSingle;
        this.MaximizeBox = false;

        tabControl = new TabControl { Dock = DockStyle.Top, Height = 390 };
        tabEncode = new TabPage("编码");
        tabDecode = new TabPage("解码");
        tabControl.TabPages.Add(tabEncode);
        tabControl.TabPages.Add(tabDecode);

        // 编码页
        var encodeLayout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 5,
            Padding = new Padding(10)
        };
        encodeLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 70));
        encodeLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        encodeLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        encodeLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        encodeLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        encodeDropPanel = new Panel
        {
            Dock = DockStyle.Fill,
            BorderStyle = BorderStyle.FixedSingle,
            BackColor = Color.LightGray,
            AllowDrop = true
        };
        var dropLabel = new Label
        {
            Text = "拖拽图片文件到此处",
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleCenter,
            ForeColor = Color.DimGray
        };
        encodeDropPanel.Controls.Add(dropLabel);
        encodeDropPanel.DragEnter += EncodeDropPanel_DragEnter!;
        encodeDropPanel.DragDrop += EncodeDropPanel_DragDrop!;
        encodeLayout.Controls.Add(encodeDropPanel, 0, 0);

        chkEncodeTextMode = new CheckBox
        {
            Text = "文字模式",
            AutoSize = true,
            Margin = new Padding(0, 5, 0, 0)
        };
        chkEncodeTextMode.CheckedChanged += ChkEncodeTextMode_CheckedChanged!;
        encodeLayout.Controls.Add(chkEncodeTextMode, 0, 1);

        encodeInputBox = new TextBox
        {
            Multiline = true,
            Dock = DockStyle.Fill,
            Visible = false,
            ScrollBars = ScrollBars.Vertical
        };
        encodeLayout.Controls.Add(encodeInputBox, 0, 0);

        btnEncode = new Button { Text = "编码", AutoSize = true, Margin = new Padding(0, 10, 0, 0) };
        btnEncode.Click += BtnEncode_Click!;
        encodeLayout.Controls.Add(btnEncode, 0, 2);

        encodeResultBox = new TextBox
        {
            Multiline = true,
            Dock = DockStyle.Fill,
            ReadOnly = true,
            ScrollBars = ScrollBars.Vertical,
            Margin = new Padding(0, 8, 0, 0)
        };
        encodeLayout.Controls.Add(encodeResultBox, 0, 3);

        var copyBtn = new Button { Text = "复制结果", AutoSize = true, Margin = new Padding(0, 8, 0, 0) };
        copyBtn.Click += (s, e) =>
        {
            if (!string.IsNullOrEmpty(encodeResultBox.Text))
            {
                Clipboard.SetText(encodeResultBox.Text);
                MessageBox.Show("已复制到剪贴板", "提示", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        };
        encodeLayout.Controls.Add(copyBtn, 0, 4);

        tabEncode.Controls.Add(encodeLayout);

        // 解码页
        var decodeLayout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 5,
            Padding = new Padding(10)
        };
        decodeLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 50));
        decodeLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        decodeLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        decodeLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        decodeLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        decodeDropPanel = new Panel
        {
            Dock = DockStyle.Fill,
            BorderStyle = BorderStyle.FixedSingle,
            BackColor = Color.LightGray,
            AllowDrop = true
        };
        var dropLabel2 = new Label
        {
            Text = "拖拽文本文件或粘贴 Base64 字符串到下方",
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleCenter,
            ForeColor = Color.DimGray
        };
        decodeDropPanel.Controls.Add(dropLabel2);
        decodeDropPanel.DragEnter += DecodeDropPanel_DragEnter!;
        decodeDropPanel.DragDrop += DecodeDropPanel_DragDrop!;
        decodeLayout.Controls.Add(decodeDropPanel, 0, 0);

        decodeInputBox = new TextBox
        {
            Multiline = true,
            Dock = DockStyle.Fill,
            ScrollBars = ScrollBars.Vertical,
            Margin = new Padding(0, 5, 0, 0)
        };
        decodeLayout.Controls.Add(decodeInputBox, 0, 1);

        btnDecode = new Button { Text = "解码", AutoSize = true, Margin = new Padding(0, 10, 0, 0) };
        btnDecode.Click += BtnDecode_Click!;
        decodeLayout.Controls.Add(btnDecode, 0, 2);

        btnSaveDecoded = new Button { Text = "保存结果", AutoSize = true, Margin = new Padding(0, 8, 0, 0), Enabled = false };
        btnSaveDecoded.Click += BtnSaveDecoded_Click!;
        decodeLayout.Controls.Add(btnSaveDecoded, 0, 3);

        var clearBtn = new Button { Text = "清空", AutoSize = true, Margin = new Padding(0, 8, 0, 0) };
        clearBtn.Click += (s, e) =>
        {
            decodeInputBox.Clear();
            btnSaveDecoded.Enabled = false;
            decodedData = null;
            decodedFileName = "";
        };
        decodeLayout.Controls.Add(clearBtn, 0, 4);

        tabDecode.Controls.Add(decodeLayout);

        var lblFooter = new Label
        {
            Text = "Base64转换工具",
            ForeColor = Color.Gray,
            Font = new Font("Microsoft YaHei", 8),
            AutoSize = false,
            TextAlign = ContentAlignment.BottomRight,
            Dock = DockStyle.Bottom,
            Height = 25,
            Padding = new Padding(0, 0, 10, 3)
        };

        var mainLayout = new TableLayoutPanel
        {
            ColumnCount = 1,
            RowCount = 2,
            Dock = DockStyle.Fill
        };
        mainLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        mainLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 25));
        mainLayout.Controls.Add(tabControl, 0, 0);
        mainLayout.Controls.Add(lblFooter, 0, 1);
        this.Controls.Add(mainLayout);
    }

    private void EncodeDropPanel_DragEnter(object? sender, DragEventArgs e)
    {
        if (e.Data!.GetDataPresent(DataFormats.FileDrop))
            e.Effect = DragDropEffects.Copy;
        else
            e.Effect = DragDropEffects.None;
    }

    private void EncodeDropPanel_DragDrop(object? sender, DragEventArgs e)
    {
        var files = (string[])e.Data!.GetData(DataFormats.FileDrop)!;
        if (files.Length > 0)
        {
            currentEncodeFile = files[0];
            encodeDropPanel.Controls[0].Text = Path.GetFileName(files[0]);
        }
    }

    private void DecodeDropPanel_DragEnter(object? sender, DragEventArgs e)
    {
        if (e.Data!.GetDataPresent(DataFormats.FileDrop))
        {
            var files = (string[])e.Data.GetData(DataFormats.FileDrop)!;
            if (files.Length > 0 && files[0].EndsWith(".txt", StringComparison.OrdinalIgnoreCase))
                e.Effect = DragDropEffects.Copy;
            else
                e.Effect = DragDropEffects.None;
        }
    }

    private void DecodeDropPanel_DragDrop(object? sender, DragEventArgs e)
    {
        var files = (string[])e.Data!.GetData(DataFormats.FileDrop)!;
        if (files.Length > 0 && files[0].EndsWith(".txt", StringComparison.OrdinalIgnoreCase))
        {
            currentDecodeFile = files[0];
            decodeInputBox.Text = File.ReadAllText(files[0]);
            decodeDropPanel.Controls[0].Text = Path.GetFileName(files[0]);
        }
    }

    private void ChkEncodeTextMode_CheckedChanged(object? sender, EventArgs e)
    {
        bool isText = chkEncodeTextMode.Checked;
        encodeDropPanel.Visible = !isText;
        encodeInputBox.Visible = isText;
    }

    private void BtnEncode_Click(object? sender, EventArgs e)
    {
        try
        {
            byte[] data;
            if (chkEncodeTextMode.Checked)
            {
                if (string.IsNullOrEmpty(encodeInputBox.Text))
                {
                    MessageBox.Show("请输入文字内容。", "提示", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }
                data = Encoding.UTF8.GetBytes(encodeInputBox.Text);
            }
            else
            {
                if (string.IsNullOrEmpty(currentEncodeFile))
                {
                    MessageBox.Show("请拖拽图片文件或勾选文字模式。", "提示", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }
                data = File.ReadAllBytes(currentEncodeFile!);
            }

            string base64 = Convert.ToBase64String(data);
            encodeResultBox.Text = base64;
        }
        catch (Exception ex)
        {
            MessageBox.Show("编码失败：" + ex.Message, "错误", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void BtnDecode_Click(object? sender, EventArgs e)
    {
        string input = decodeInputBox.Text.Trim();
        if (string.IsNullOrEmpty(input))
        {
            MessageBox.Show("请输入 Base64 字符串。", "提示", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        try
        {
            input = input.Replace("\r", "").Replace("\n", "").Replace(" ", "");
            byte[] data = Convert.FromBase64String(input);
            decodedData = data;

            if (IsImage(data))
            {
                decodedFileName = "decoded_image.png";
                btnSaveDecoded.Text = "保存图片";
            }
            else
            {
                decodedFileName = "decoded_text.txt";
                btnSaveDecoded.Text = "保存文本";
            }
            btnSaveDecoded.Enabled = true;
            MessageBox.Show("解码成功，请点击保存。", "提示", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (FormatException)
        {
            MessageBox.Show("无效的 Base64 字符串。", "错误", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        catch (Exception ex)
        {
            MessageBox.Show("解码失败：" + ex.Message, "错误", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private bool IsImage(byte[] bytes)
    {
        if (bytes.Length < 4) return false;
        if (bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47) return true;
        if (bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF) return true;
        if (bytes[0] == 0x47 && bytes[1] == 0x49 && bytes[2] == 0x46) return true;
        if (bytes[0] == 0x42 && bytes[1] == 0x4D) return true;
        return false;
    }

    private void BtnSaveDecoded_Click(object? sender, EventArgs e)
    {
        if (decodedData == null || string.IsNullOrEmpty(decodedFileName))
        {
            MessageBox.Show("没有可保存的数据。", "提示", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        string defaultExt = Path.GetExtension(decodedFileName);
        if (string.IsNullOrEmpty(defaultExt)) defaultExt = ".dat";

        using var sfd = new SaveFileDialog
        {
            Filter = "所有文件 (*.*)|*.*",
            FileName = decodedFileName,
            DefaultExt = defaultExt
        };
        if (sfd.ShowDialog() != DialogResult.OK) return;

        try
        {
            File.WriteAllBytes(sfd.FileName, decodedData);
            MessageBox.Show("文件保存成功！", "提示", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception ex)
        {
            MessageBox.Show("保存失败：" + ex.Message, "错误", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    [STAThread]
    static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new MainForm());
    }
}