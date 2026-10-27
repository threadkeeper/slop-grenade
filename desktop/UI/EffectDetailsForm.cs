using System;
using System.Drawing;
using System.Windows.Forms;

namespace SlopGrenadeDesktop
{
    internal sealed class EffectDetailsForm : Form
    {
        private EffectMessage _message;
        private string _text = "";

        public EffectDetailsForm()
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            TopMost = true;
            Opacity = 0.98;
            BackColor = SteampunkArt.InkC;
            ForeColor = SteampunkArt.Cream;
            Font = new Font("Segoe UI", 9.5f);
            DoubleBuffered = true;
            AccessibleName = "Message behind this effect";
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams parameters = base.CreateParams;
                parameters.ExStyle |= NativeMethods.WS_EX_LAYERED | NativeMethods.WS_EX_TRANSPARENT |
                    NativeMethods.WS_EX_NOACTIVATE | NativeMethods.WS_EX_TOOLWINDOW | NativeMethods.WS_EX_TOPMOST;
                return parameters;
            }
        }

        protected override bool ShowWithoutActivation { get { return true; } }

        public void ShowMessage(EffectMessage message, Point cursor, Rectangle workingArea)
        {
            if (message == _message && Visible) return;
            _message = message;
            _text = message.DetailsText();
            int width = Math.Min(440, Math.Max(1, workingArea.Width - 16));
            Size measured = TextRenderer.MeasureText(_text, Font, new Size(Math.Max(1, width - 28), int.MaxValue),
                TextFormatFlags.WordBreak | TextFormatFlags.NoPrefix | TextFormatFlags.TextBoxControl);
            Bounds = Place(cursor, new Size(width, measured.Height + 28), workingArea);
            AccessibleDescription = _text;
            Invalidate();
            Show();
            BringToFront();
        }

        public void ClearMessage()
        {
            if (_message == null && !Visible) return;
            Hide();
            _message = null;
            _text = "";
            AccessibleDescription = "";
        }

        public static Rectangle Place(Point cursor, Size desired, Rectangle workingArea)
        {
            int width = Math.Min(desired.Width, Math.Max(1, workingArea.Width - 16));
            int height = Math.Min(desired.Height, Math.Max(1, workingArea.Height - 16));
            int x = cursor.X + 18;
            if (x + width > workingArea.Right - 8) x = cursor.X - width - 18;
            int y = cursor.Y + 18;
            if (y + height > workingArea.Bottom - 8) y = cursor.Y - height - 18;
            x = Math.Max(workingArea.Left + 8, Math.Min(x, workingArea.Right - width - 8));
            y = Math.Max(workingArea.Top + 8, Math.Min(y, workingArea.Bottom - height - 8));
            return new Rectangle(x, y, width, height);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            using (Pen border = new Pen(SteampunkArt.BrassB, 2f))
                e.Graphics.DrawRectangle(border, 1, 1, Width - 3, Height - 3);
            TextRenderer.DrawText(e.Graphics, _text, Font, new Rectangle(14, 14, Math.Max(1, Width - 28), Math.Max(1, Height - 28)),
                ForeColor, TextFormatFlags.WordBreak | TextFormatFlags.NoPrefix | TextFormatFlags.TextBoxControl | TextFormatFlags.EndEllipsis);
        }

        protected override void WndProc(ref Message message)
        {
            if (message.Msg == 0x0084) { message.Result = new IntPtr(-1); return; }
            if (message.Msg == 0x0021) { message.Result = new IntPtr(3); return; }
            base.WndProc(ref message);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) Font.Dispose();
            base.Dispose(disposing);
        }
    }
}
