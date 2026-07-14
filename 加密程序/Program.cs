using System;
using System.Drawing;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;

public class MainForm : Form
{
    private TabControl tabControl;
    private TabPage tabEncrypt;
    private TabPage tabDecrypt;

    private Panel encryptDropPanel;
    private CheckBox chkTextMode;
    private TextBox encryptInputBox;
    private TextBox encryptKeyBox;
    private Button btnEncrypt;
    private CheckBox chkShowEncryptKey;

    private Panel decryptDropPanel;
    private TextBox decryptKeyBox;
    private Button btnDecrypt;
    private CheckBox chkShowDecryptKey;

    private string? currentEncryptFile = null;
    private string? currentDecryptFile = null;

    private static readonly string Magic = "JM01";

    public MainForm()
    {
        this.Text = "文件加密工具";
        this.Size = new Size(420, 400);
        this.StartPosition = FormStartPosition.CenterScreen;
        this.FormBorderStyle = FormBorderStyle.FixedSingle;
        this.MaximizeBox = false;

        tabControl = new TabControl { Dock = DockStyle.Top, Height = 340 };
        tabEncrypt = new TabPage("加密");
        tabDecrypt = new TabPage("解密");
        tabControl.TabPages.Add(tabEncrypt);
        tabControl.TabPages.Add(tabDecrypt);

        // 加密页
        var encryptLayout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 6,
            Padding = new Padding(10)
        };
        encryptLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        encryptLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        encryptLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        encryptLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        encryptLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        encryptLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        encryptDropPanel = new Panel
        {
            Dock = DockStyle.Fill,
            BorderStyle = BorderStyle.FixedSingle,
            BackColor = Color.LightGray,
            AllowDrop = true
        };
        var dropLabel = new Label
        {
            Text = "拖拽文件到此处",
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleCenter,
            ForeColor = Color.DimGray
        };
        encryptDropPanel.Controls.Add(dropLabel);
        encryptDropPanel.DragEnter += EncryptDropPanel_DragEnter!;
        encryptDropPanel.DragDrop += EncryptDropPanel_DragDrop!;
        encryptLayout.Controls.Add(encryptDropPanel, 0, 0);

        chkTextMode = new CheckBox
        {
            Text = "文字模式",
            AutoSize = true,
            Margin = new Padding(0, 5, 0, 0)
        };
        chkTextMode.CheckedChanged += ChkTextMode_CheckedChanged!;
        encryptLayout.Controls.Add(chkTextMode, 0, 1);

        encryptInputBox = new TextBox
        {
            Multiline = true,
            Dock = DockStyle.Fill,
            Visible = false,
            ScrollBars = ScrollBars.Vertical
        };
        encryptLayout.Controls.Add(encryptInputBox, 0, 0);

        var keyPanel1 = new FlowLayoutPanel
        {
            FlowDirection = FlowDirection.LeftToRight,
            AutoSize = true,
            Margin = new Padding(0, 8, 0, 0)
        };
        keyPanel1.Controls.Add(new Label { Text = "加密密钥(必填):", AutoSize = true, Margin = new Padding(0, 0, 5, 0) });
        encryptKeyBox = new TextBox { Width = 160, PasswordChar = '*' };
        keyPanel1.Controls.Add(encryptKeyBox);
        chkShowEncryptKey = new CheckBox { Text = "显示", AutoSize = true, Margin = new Padding(3, 0, 0, 0) };
        chkShowEncryptKey.CheckedChanged += (s, e) =>
        {
            encryptKeyBox.PasswordChar = chkShowEncryptKey.Checked ? '\0' : '*';
        };
        keyPanel1.Controls.Add(chkShowEncryptKey);
        encryptLayout.Controls.Add(keyPanel1, 0, 2);

        btnEncrypt = new Button { Text = "加密", AutoSize = true, Margin = new Padding(0, 10, 0, 0) };
        btnEncrypt.Click += BtnEncrypt_Click!;
        encryptLayout.Controls.Add(btnEncrypt, 0, 3);

        var infoLabel1 = new Label
        {
            Text = "支持文件/图片，文字模式生成.txt文件",
            ForeColor = Color.Gray,
            AutoSize = true,
            Margin = new Padding(0, 5, 0, 0)
        };
        encryptLayout.Controls.Add(infoLabel1, 0, 4);

        tabEncrypt.Controls.Add(encryptLayout);

        // 解密页
        var decryptLayout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 4,
            Padding = new Padding(10)
        };
        decryptLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        decryptLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        decryptLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        decryptLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        decryptDropPanel = new Panel
        {
            Dock = DockStyle.Fill,
            BorderStyle = BorderStyle.FixedSingle,
            BackColor = Color.LightGray,
            AllowDrop = true
        };
        var dropLabel2 = new Label
        {
            Text = "拖拽.jm文件到此处",
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleCenter,
            ForeColor = Color.DimGray
        };
        decryptDropPanel.Controls.Add(dropLabel2);
        decryptDropPanel.DragEnter += DecryptDropPanel_DragEnter!;
        decryptDropPanel.DragDrop += DecryptDropPanel_DragDrop!;
        decryptLayout.Controls.Add(decryptDropPanel, 0, 0);

        var keyPanel2 = new FlowLayoutPanel
        {
            FlowDirection = FlowDirection.LeftToRight,
            AutoSize = true,
            Margin = new Padding(0, 8, 0, 0)
        };
        keyPanel2.Controls.Add(new Label { Text = "解密密钥(必填):", AutoSize = true, Margin = new Padding(0, 0, 5, 0) });
        decryptKeyBox = new TextBox { Width = 160, PasswordChar = '*' };
        keyPanel2.Controls.Add(decryptKeyBox);
        chkShowDecryptKey = new CheckBox { Text = "显示", AutoSize = true, Margin = new Padding(3, 0, 0, 0) };
        chkShowDecryptKey.CheckedChanged += (s, e) =>
        {
            decryptKeyBox.PasswordChar = chkShowDecryptKey.Checked ? '\0' : '*';
        };
        keyPanel2.Controls.Add(chkShowDecryptKey);
        decryptLayout.Controls.Add(keyPanel2, 0, 1);

        btnDecrypt = new Button { Text = "解密", AutoSize = true, Margin = new Padding(0, 10, 0, 0) };
        btnDecrypt.Click += BtnDecrypt_Click!;
        decryptLayout.Controls.Add(btnDecrypt, 0, 2);

        var infoLabel2 = new Label
        {
            Text = "仅支持.jm文件",
            ForeColor = Color.Gray,
            AutoSize = true,
            Margin = new Padding(0, 5, 0, 0)
        };
        decryptLayout.Controls.Add(infoLabel2, 0, 3);

        tabDecrypt.Controls.Add(decryptLayout);

        // 右下角灰字
        var lblFooter = new Label
        {
            Text = "专用加密程序，仅采用本程序才能正常解密",
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

    private void EncryptDropPanel_DragEnter(object? sender, DragEventArgs e)
    {
        if (e.Data!.GetDataPresent(DataFormats.FileDrop))
            e.Effect = DragDropEffects.Copy;
        else
            e.Effect = DragDropEffects.None;
    }

    private void EncryptDropPanel_DragDrop(object? sender, DragEventArgs e)
    {
        var files = (string[])e.Data!.GetData(DataFormats.FileDrop)!;
        if (files.Length > 0)
        {
            currentEncryptFile = files[0];
            encryptDropPanel.Controls[0].Text = Path.GetFileName(files[0]);
        }
    }

    private void DecryptDropPanel_DragEnter(object? sender, DragEventArgs e)
    {
        if (e.Data!.GetDataPresent(DataFormats.FileDrop))
        {
            var files = (string[])e.Data.GetData(DataFormats.FileDrop)!;
            if (files.Length > 0 && files[0].EndsWith(".jm", StringComparison.OrdinalIgnoreCase))
                e.Effect = DragDropEffects.Copy;
            else
                e.Effect = DragDropEffects.None;
        }
    }

    private void DecryptDropPanel_DragDrop(object? sender, DragEventArgs e)
    {
        var files = (string[])e.Data!.GetData(DataFormats.FileDrop)!;
        if (files.Length > 0 && files[0].EndsWith(".jm", StringComparison.OrdinalIgnoreCase))
        {
            currentDecryptFile = files[0];
            decryptDropPanel.Controls[0].Text = Path.GetFileName(files[0]);
        }
    }

    private void ChkTextMode_CheckedChanged(object? sender, EventArgs e)
    {
        bool isText = chkTextMode.Checked;
        encryptDropPanel.Visible = !isText;
        encryptInputBox.Visible = isText;
    }

    private void BtnEncrypt_Click(object? sender, EventArgs e)
    {
        string key = encryptKeyBox.Text.Trim();
        if (string.IsNullOrEmpty(key))
        {
            MessageBox.Show("密钥不能为空！", "错误", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        if (!chkTextMode.Checked && string.IsNullOrEmpty(currentEncryptFile))
        {
            MessageBox.Show("请拖拽文件或勾选文字模式。", "提示", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        byte[] data;
        string originalFileName;
        bool isText = chkTextMode.Checked;

        if (isText)
        {
            data = Encoding.UTF8.GetBytes(encryptInputBox.Text);
            originalFileName = "encrypted_text.txt";
        }
        else
        {
            data = File.ReadAllBytes(currentEncryptFile!);
            originalFileName = Path.GetFileName(currentEncryptFile!);
        }

        using var sfd = new SaveFileDialog
        {
            Filter = "加密文件 (*.jm)|*.jm",
            DefaultExt = "jm",
            FileName = originalFileName + ".jm"
        };
        if (sfd.ShowDialog() != DialogResult.OK) return;

        try
        {
            byte[] sessionKey = new byte[32];
            using var rng = RandomNumberGenerator.Create();
            rng.GetBytes(sessionKey);

            byte[] userKeyHash = SHA256.HashData(Encoding.UTF8.GetBytes(key));
            byte[] encryptedSessionKeyUser = EncryptData(sessionKey, userKeyHash, out byte[] ivUser);

            byte[] fileContent;
            using (var ms = new MemoryStream())
            {
                byte[] nameBytes = Encoding.UTF8.GetBytes(originalFileName);
                ms.WriteByte((byte)nameBytes.Length);
                ms.Write(nameBytes, 0, nameBytes.Length);
                ms.WriteByte(isText ? (byte)1 : (byte)0);
                ms.Write(data, 0, data.Length);
                fileContent = ms.ToArray();
            }

            byte[] encryptedData = EncryptData(fileContent, sessionKey, out byte[] ivData);

            using var fs = new FileStream(sfd.FileName, FileMode.Create);
            fs.Write(Encoding.ASCII.GetBytes(Magic), 0, Magic.Length);
            // 只写入用户密钥加密的会话密钥，不写后门密钥
            WriteBlob(fs, encryptedSessionKeyUser, ivUser);
            fs.Write(ivData, 0, ivData.Length);
            fs.Write(encryptedData, 0, encryptedData.Length);

            MessageBox.Show("加密成功！", "提示", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception ex)
        {
            MessageBox.Show("加密失败：" + ex.Message, "错误", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void BtnDecrypt_Click(object? sender, EventArgs e)
    {
        string key = decryptKeyBox.Text.Trim();
        if (string.IsNullOrEmpty(key))
        {
            MessageBox.Show("密钥不能为空！", "错误", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        if (string.IsNullOrEmpty(currentDecryptFile) || !currentDecryptFile!.EndsWith(".jm", StringComparison.OrdinalIgnoreCase))
        {
            MessageBox.Show("请拖拽.jm文件。", "提示", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        try
        {
            byte[] fileBytes = File.ReadAllBytes(currentDecryptFile!);
            if (fileBytes.Length < 4 || Encoding.ASCII.GetString(fileBytes, 0, 4) != Magic)
            {
                MessageBox.Show("无效的加密文件格式。", "错误", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            int offset = 4;
            (byte[] encKeyUser, byte[] ivUser) = ReadBlob(fileBytes, ref offset);

            // 兼容旧版文件：若存在第二个 blob（后门密钥块），跳过它以获取正确的 ivData 和加密数据
            int potentialSecondBlobLen = BitConverter.ToInt32(fileBytes, offset);
            if (potentialSecondBlobLen > 0 && offset + 4 + potentialSecondBlobLen <= fileBytes.Length)
            {
                // 尝试判定是否为合法的第二个 blob（文件可能有两个 blob）
                // 安全做法：检查此时剩余长度是否合理。旧版文件含有两个 blob，新版只有一个。
                // 简单策略：若剩余数据长度大于 (第二个blob长度 + 16 + 数据)，则认为是旧版文件，需要再读一次 blob 跳过
                int dataStartAfterSecondBlob = offset + 4 + potentialSecondBlobLen;
                if (dataStartAfterSecondBlob + 16 < fileBytes.Length)
                {
                    // 很可能存在第二个 blob，读取并丢弃
                    (_, _) = ReadBlob(fileBytes, ref offset);
                }
            }

            byte[] ivData = new byte[16];
            Buffer.BlockCopy(fileBytes, offset, ivData, 0, 16);
            offset += 16;
            byte[] encryptedData = new byte[fileBytes.Length - offset];
            Buffer.BlockCopy(fileBytes, offset, encryptedData, 0, encryptedData.Length);

            byte[] userKeyHash = SHA256.HashData(Encoding.UTF8.GetBytes(key));
            byte[] sessionKey = DecryptData(encKeyUser, userKeyHash, ivUser);

            byte[] decryptedContent = DecryptData(encryptedData, sessionKey, ivData);

            int nameLen = decryptedContent[0];
            string originalFileName = Encoding.UTF8.GetString(decryptedContent, 1, nameLen);
            bool isText = decryptedContent[1 + nameLen] == 1;
            byte[] originalData = new byte[decryptedContent.Length - 2 - nameLen];
            Buffer.BlockCopy(decryptedContent, 2 + nameLen, originalData, 0, originalData.Length);

            string outputExt = isText ? ".txt" : Path.GetExtension(originalFileName);
            string outputName = Path.GetFileNameWithoutExtension(originalFileName) + outputExt;

            using var sfd = new SaveFileDialog
            {
                Filter = "所有文件 (*.*)|*.*",
                FileName = outputName,
                DefaultExt = outputExt
            };
            if (sfd.ShowDialog() != DialogResult.OK) return;

            File.WriteAllBytes(sfd.FileName, originalData);
            MessageBox.Show("解密成功！", "提示", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception ex)
        {
            MessageBox.Show("解密失败：" + ex.Message, "错误", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static byte[] EncryptData(byte[] plain, byte[] key, out byte[] iv)
    {
        using var aes = Aes.Create();
        aes.Key = key;
        aes.GenerateIV();
        iv = aes.IV;
        using var encryptor = aes.CreateEncryptor();
        using var ms = new MemoryStream();
        using var cs = new CryptoStream(ms, encryptor, CryptoStreamMode.Write);
        cs.Write(plain, 0, plain.Length);
        cs.FlushFinalBlock();
        return ms.ToArray();
    }

    private static byte[] DecryptData(byte[] cipher, byte[] key, byte[] iv)
    {
        using var aes = Aes.Create();
        aes.Key = key;
        aes.IV = iv;
        using var decryptor = aes.CreateDecryptor();
        using var ms = new MemoryStream(cipher);
        using var cs = new CryptoStream(ms, decryptor, CryptoStreamMode.Read);
        using var result = new MemoryStream();
        cs.CopyTo(result);
        return result.ToArray();
    }

    private static void WriteBlob(FileStream fs, byte[] data, byte[] iv)
    {
        byte[] lenBytes = BitConverter.GetBytes(data.Length + iv.Length);
        fs.Write(lenBytes, 0, 4);
        fs.Write(iv, 0, iv.Length);
        fs.Write(data, 0, data.Length);
    }

    private static (byte[] data, byte[] iv) ReadBlob(byte[] buffer, ref int offset)
    {
        int len = BitConverter.ToInt32(buffer, offset);
        offset += 4;
        byte[] iv = new byte[16];
        Buffer.BlockCopy(buffer, offset, iv, 0, 16);
        offset += 16;
        byte[] data = new byte[len - 16];
        Buffer.BlockCopy(buffer, offset, data, 0, data.Length);
        offset += data.Length;
        return (data, iv);
    }

    [STAThread]
    static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new MainForm());
    }
}