using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Shapes;

namespace OmenLite;

/// 270° arc gauge; value animates (count-up) on every update.
public sealed class Gauge : Grid
{
    const double D = 140, T = 10, WarnAt = 85;
    public static readonly DependencyProperty ValueProperty = DependencyProperty.Register(
        nameof(Value), typeof(double), typeof(Gauge), new PropertyMetadata(0.0, (d, _) => ((Gauge)d).Render()));

    readonly Ellipse _track, _arc;
    readonly TextBlock _num = new() { FontSize = 36, FontWeight = FontWeights.SemiBold, HorizontalAlignment = HorizontalAlignment.Center };
    readonly TextBlock _label = new() { FontSize = 12, HorizontalAlignment = HorizontalAlignment.Center };
    bool _hasValue;

    public double Value { get => (double)GetValue(ValueProperty); set => SetValue(ValueProperty, value); }
    public double Max { get; set; } = 100;
    public string Label { get => _label.Text; set => _label.Text = value; }

    public Gauge()
    {
        Width = Height = D;
        _track = Ring("Rule");
        _arc = Ring("Accent");
        _num.FontFamily = (FontFamily)Application.Current.FindResource("Display");
        _label.Foreground = (Brush)Application.Current.FindResource("Muted");
        var center = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        center.Children.Add(_num);
        center.Children.Add(_label);
        Children.Add(_track);
        Children.Add(_arc);
        Children.Add(center);
        Render();
    }

    static Ellipse Ring(string brush) => new()
    {
        Width = D, Height = D, StrokeThickness = T,
        Stroke = (Brush)Application.Current.FindResource(brush),
        StrokeDashCap = PenLineCap.Round,
        RenderTransformOrigin = new Point(0.5, 0.5),
        RenderTransform = new RotateTransform(135), // arc starts bottom-left, sweeps clockwise
    };

    public void AnimateTo(double? v)
    {
        _hasValue = v.HasValue;
        var to = v ?? 0;
        if (!SystemParameters.ClientAreaAnimation) { BeginAnimation(ValueProperty, null); Value = to; return; }
        BeginAnimation(ValueProperty, new DoubleAnimation(to, TimeSpan.FromMilliseconds(600))
            { EasingFunction = (IEasingFunction)Application.Current.FindResource("EaseOut") });
    }

    void Render()
    {
        double span = 0.75 * Math.PI * (D - T) / T; // dash units are multiples of stroke thickness
        double frac = Math.Clamp(Value / Max, 0, 1);
        _track.StrokeDashArray = [span, 1000];
        _arc.StrokeDashArray = [Math.Max(frac * span, 0.0001), 1000];
        _arc.Visibility = _hasValue ? Visibility.Visible : Visibility.Hidden;
        _arc.Stroke = (Brush)Application.Current.FindResource(Value >= WarnAt ? "Warn" : "Accent");
        _num.Text = _hasValue ? $"{Value:F0}°" : "—";
    }
}
