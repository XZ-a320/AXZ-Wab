using System;
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

class WinKeyBlocker : Form
{
    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);
    private static LowLevelKeyboardProc _proc = HookCallback!;
    private static IntPtr _hookID = IntPtr.Zero;
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int VK_LWIN = 0x5B;
    private const int VK_RWIN = 0x5C;

    private CheckBox chkDisable;
    private Keys _mappedKey = Keys.None;
    private bool _isSending = false;

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);
    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);
    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string lpModuleName);
    [DllImport("user32.dll")]
    private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    private const int KEYEVENTF_KEYDOWN = 0x0000;
    private const int KEYEVENTF_KEYUP = 0x0002;

    private static WinKeyBlocker? _instance = null;

    private static IntPtr SetHook(LowLevelKeyboardProc proc)
    {
        using (Process curProcess = Process.GetCurrentProcess())
        using (ProcessModule curModule = curProcess.MainModule!)
        {
            return SetWindowsHookEx(WH_KEYBOARD_LL, proc,
                GetModuleHandle(curModule.ModuleName), 0);
        }
    }

    private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (_instance != null)
            return _instance.HookCallbackInstance(nCode, wParam, lParam);
        return CallNextHookEx(_hookID, nCode, wParam, lParam);
    }

    private IntPtr HookCallbackInstance(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0 && (wParam == (IntPtr)WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN))
        {
            int vkCode = Marshal.ReadInt32(lParam);
            if (vkCode == VK_LWIN || vkCode == VK_RWIN)
            {
                if (chkDisable.Checked || _mappedKey != Keys.None)
                {
                    if (_mappedKey != Keys.None && !_isSending)
                    {
                        _isSending = true;
                        keybd_event((byte)_mappedKey, 0, KEYEVENTF_KEYDOWN, UIntPtr.Zero);
                        keybd_event((byte)_mappedKey, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                        _isSending = false;
                    }
                    return (IntPtr)1;
                }
            }
        }
        return CallNextHookEx(_hookID, nCode, wParam, lParam);
    }

    public WinKeyBlocker()
    {
        _instance = this;
        this.Text = "Win键工具";
        this.Size = new Size(300, 200);
        this.StartPosition = FormStartPosition.CenterScreen;
        this.FormBorderStyle = FormBorderStyle.FixedSingle;
        this.MaximizeBox = false;
        this.BackColor = Color.Black;
        this.ForeColor = Color.White;

        Label label = new Label
        {
            Text = "Win键已禁用",
            Font = new Font("Microsoft YaHei", 16, FontStyle.Bold),
            ForeColor = Color.White,
            BackColor = Color.Transparent,
            AutoSize = false,
            TextAlign = ContentAlignment.MiddleCenter,
            Dock = DockStyle.Top,
            Height = 100
        };
        this.Controls.Add(label);

        var bottomPanel = new FlowLayoutPanel
        {
            Dock = DockStyle.Bottom,
            FlowDirection = FlowDirection.LeftToRight,
            Padding = new Padding(10),
            BackColor = Color.Black,
            Height = 60
        };

        chkDisable = new CheckBox
        {
            Text = "禁用Win键",
            Checked = true,
            AutoSize = true,
            ForeColor = Color.White,
            BackColor = Color.Transparent
        };
        chkDisable.CheckedChanged += (s, e) => { /* 勾选状态变化无需额外操作 */ };

        var btnMapping = new Button
        {
            Text = "按键映射",
            AutoSize = true,
            Margin = new Padding(10, 0, 0, 0)
        };
        btnMapping.Click += BtnMapping_Click;

        bottomPanel.Controls.Add(chkDisable);
        bottomPanel.Controls.Add(btnMapping);
        this.Controls.Add(bottomPanel);

        _hookID = SetHook(_proc);

        this.FormClosing += (s, e) =>
        {
            UnhookWindowsHookEx(_hookID);
            _instance = null;
        };
    }

    private void BtnMapping_Click(object? sender, EventArgs e)
    {
        using (var dialog = new MappingDialog())
        {
            if (dialog.ShowDialog() == DialogResult.OK)
            {
                _mappedKey = dialog.SelectedKey;
                if (_mappedKey != Keys.None)
                    MessageBox.Show($"Win键已映射为 {_mappedKey}", "提示", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        }
    }

    [STAThread]
    static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new WinKeyBlocker());
    }
}

class MappingDialog : Form
{
    public Keys SelectedKey { get; private set; } = Keys.None;
    private Label lblKey;
    private bool keyCaptured = false;

    public MappingDialog()
    {
        this.Text = "Win键映射";
        this.Size = new Size(300, 150);
        this.StartPosition = FormStartPosition.CenterParent;
        this.FormBorderStyle = FormBorderStyle.FixedDialog;
        this.MaximizeBox = false;
        this.KeyPreview = true;

        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2, Padding = new Padding(10) };
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 70));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        lblKey = new Label
        {
            Text = "请按下要映射到的按键...",
            TextAlign = ContentAlignment.MiddleCenter,
            Font = new Font("Microsoft YaHei", 10),
            AutoSize = false,
            Dock = DockStyle.Fill,
            BorderStyle = BorderStyle.FixedSingle
        };
        layout.Controls.Add(lblKey, 0, 0);

        var btnPanel = new FlowLayoutPanel { FlowDirection = FlowDirection.RightToLeft, AutoSize = true, Anchor = AnchorStyles.Right };
        var btnCancel = new Button { Text = "取消", AutoSize = true };
        btnCancel.Click += (s, e) => { DialogResult = DialogResult.Cancel; Close(); };
        var btnOk = new Button { Text = "确定", AutoSize = true, Margin = new Padding(0, 0, 10, 0) };
        btnOk.Click += (s, e) =>
        {
            if (!keyCaptured) { MessageBox.Show("请先按下一个键。", "提示", MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
            DialogResult = DialogResult.OK;
            Close();
        };
        btnPanel.Controls.Add(btnCancel);
        btnPanel.Controls.Add(btnOk);
        layout.Controls.Add(btnPanel, 0, 1);

        this.Controls.Add(layout);
        this.KeyDown += Dialog_KeyDown;
    }

    private void Dialog_KeyDown(object? sender, KeyEventArgs e)
    {
        if (e.KeyCode == Keys.ShiftKey || e.KeyCode == Keys.ControlKey || e.KeyCode == Keys.Menu ||
            e.KeyCode == Keys.LWin || e.KeyCode == Keys.RWin) return;
        SelectedKey = e.KeyCode;
        keyCaptured = true;
        lblKey.Text = $"将 Win 键改为：{SelectedKey}";
        this.KeyDown -= Dialog_KeyDown;
    }

    protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
    {
        KeyEventArgs e = new KeyEventArgs(keyData);
        Dialog_KeyDown(this, e);
        return true;
    }
}