using System.Drawing;

namespace SlopGrenadeDesktop
{
    internal sealed class EffectHoverTracker
    {
        private EffectMessage _target;
        private Point _anchor;
        private double _since;
        private bool _shown;

        public EffectMessage Update(EffectMessage message, Point cursor, double milliseconds)
        {
            if (message != _target || (!_shown && (System.Math.Abs(cursor.X - _anchor.X) > 6 || System.Math.Abs(cursor.Y - _anchor.Y) > 6)))
            {
                _target = message;
                _anchor = cursor;
                _since = milliseconds;
                _shown = false;
            }
            if (message == null || milliseconds - _since < 500 || milliseconds - _since > 10500) return null;
            _shown = true;
            return message;
        }
    }
}
