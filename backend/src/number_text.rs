//! 文字列列の数値比較・集計用。型付き整数の変換規則とは区別する。

pub fn parse_finite_number(value: &str) -> Option<f64> {
    value
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|number| number.is_finite())
}
