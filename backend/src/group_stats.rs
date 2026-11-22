//! 集計項目ごとの状態。平均は合計のオーバーフローを避けて逐次更新する。
#[derive(Clone, Copy)]
pub enum Metric {
    Sum,
    Average,
    Min,
    Max,
}
impl Metric {
    pub fn label(self) -> &'static str {
        match self {
            Self::Sum => "合計",
            Self::Average => "平均",
            Self::Min => "最小値",
            Self::Max => "最大値",
        }
    }
}
#[derive(Clone, Default)]
pub struct Statistic {
    value: f64,
    count: usize,
}
impl Statistic {
    pub fn add(&mut self, value: f64, metric: Metric) -> Result<(), String> {
        self.count += 1;
        self.value = match metric {
            Metric::Sum => self.value + value,
            Metric::Average if self.count == 1 => value,
            Metric::Average => {
                let n = self.count as f64;
                if self.value.is_sign_positive() == value.is_sign_positive() {
                    self.value + (value - self.value) / n
                } else {
                    self.value * (1.0 - 1.0 / n) + value / n
                }
            }
            Metric::Min if self.count > 1 => self.value.min(value),
            Metric::Max if self.count > 1 => self.value.max(value),
            _ => value,
        };
        if !self.value.is_finite() {
            return Err(format!("{}が数値の範囲を超えました。", metric.label()));
        }
        Ok(())
    }
    pub fn text(&self, metric: Metric) -> String {
        if self.count == 0 && !matches!(metric, Metric::Sum) {
            return String::new();
        }
        if self.value == 0.0 {
            "0".into()
        } else {
            self.value.to_string()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn average_avoids_overflow_and_preserves_finite_extremes() {
        let mut mean = Statistic::default();
        for n in [1e308, 1e308, -1e308, -1e308] {
            mean.add(n, Metric::Average).unwrap();
        }
        assert!(mean.value.abs() < 1e293);
        let mut mean = Statistic::default();
        mean.add(f64::MAX, Metric::Average).unwrap();
        mean.add(f64::MAX, Metric::Average).unwrap();
        assert_eq!(mean.value, f64::MAX);
        let mut min = Statistic::default();
        let mut max = Statistic::default();
        for n in [-8.0, -2.0, -5.0] {
            min.add(n, Metric::Min).unwrap();
            max.add(n, Metric::Max).unwrap();
        }
        assert_eq!(min.text(Metric::Min), "-8");
        assert_eq!(max.text(Metric::Max), "-2");
    }
}
