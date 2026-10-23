// DirtyRegion.cs
// Collects the screen rectangles that changed this frame so the overlay only
// clears, redraws and presents those areas (a settled screen costs nothing).

using System;
using System.Collections.Generic;
using System.Drawing;

namespace SlopGrenadeDesktop
{
    internal sealed class DirtyRegion
    {
        private readonly List<Rectangle> _rects = new List<Rectangle>();
        private readonly int _w, _h;
        private bool _full;

        public DirtyRegion(int w, int h)
        {
            _w = w;
            _h = h;
        }

        public bool IsEmpty { get { return !_full && _rects.Count == 0; } }

        public bool IsFull { get { return _full; } }

        public void Clear()
        {
            _rects.Clear();
            _full = false;
        }

        public void AddFull()
        {
            _full = true;
        }

        public void Add(RectangleF r)
        {
            if (_full || r.Width <= 0f || r.Height <= 0f) return;
            int x0 = Math.Max(0, (int)Math.Floor(r.Left) - 3);
            int y0 = Math.Max(0, (int)Math.Floor(r.Top) - 3);
            int x1 = Math.Min(_w, (int)Math.Ceiling(r.Right) + 3);
            int y1 = Math.Min(_h, (int)Math.Ceiling(r.Bottom) + 3);
            if (x1 <= x0 || y1 <= y0) return;
            Add(Rectangle.FromLTRB(x0, y0, x1, y1));
        }

        public void Add(Rectangle r)
        {
            if (_full) return;
            Rectangle cur = r;
            bool merged = true;
            while (merged)
            {
                merged = false;
                for (int i = 0; i < _rects.Count; i++)
                {
                    Rectangle o = _rects[i];
                    Rectangle grown = Rectangle.Inflate(o, 24, 24);
                    if (grown.IntersectsWith(cur))
                    {
                        cur = Rectangle.Union(o, cur);
                        _rects.RemoveAt(i);
                        merged = true;
                        break;
                    }
                }
            }
            _rects.Add(cur);
            // too many pieces: merge the pair that wastes the least area, so the two
            // monitor edges stay separate instead of becoming one screen-wide block
            while (_rects.Count > 8)
            {
                int bi = 0, bj = 1;
                long best = long.MaxValue;
                for (int i = 0; i < _rects.Count; i++)
                {
                    for (int j = i + 1; j < _rects.Count; j++)
                    {
                        Rectangle u = Rectangle.Union(_rects[i], _rects[j]);
                        long waste = (long)u.Width * u.Height
                            - (long)_rects[i].Width * _rects[i].Height
                            - (long)_rects[j].Width * _rects[j].Height;
                        if (waste < best) { best = waste; bi = i; bj = j; }
                    }
                }
                Rectangle pair = Rectangle.Union(_rects[bi], _rects[bj]);
                _rects.RemoveAt(bj);
                _rects.RemoveAt(bi);
                _rects.Add(pair);
            }
            long area = 0;
            for (int i = 0; i < _rects.Count; i++) area += (long)_rects[i].Width * _rects[i].Height;
            if (area > (long)_w * _h * 6 / 10) _full = true;
        }

        public void AddAll(DirtyRegion other)
        {
            if (other._full) { _full = true; return; }
            for (int i = 0; i < other._rects.Count; i++) Add(other._rects[i]);
        }

        public List<Rectangle> Rects()
        {
            if (_full) return new List<Rectangle> { new Rectangle(0, 0, _w, _h) };
            return new List<Rectangle>(_rects);
        }
    }
}
