/// 按前端选择的编码把文本转成发送字节（串口、蓝牙共用）
///
/// 未知编码按 UTF-8 处理；ASCII 模式下非 ASCII 字符替换为 `?`。
pub fn encode_text(text: &str, encoding: &str) -> Vec<u8> {
    match encoding.to_lowercase().as_str() {
        "ascii" => text
            .chars()
            .map(|character| if character.is_ascii() { character as u8 } else { b'?' })
            .collect(),
        "gbk" | "gb2312" => encoding_rs::GBK.encode(text).0.into_owned(),
        _ => text.as_bytes().to_vec(),
    }
}

#[cfg(test)]
mod tests {
    use super::encode_text;

    #[test]
    fn encodes_supported_encodings() {
        assert_eq!(encode_text("中文", "GBK"), [0xd6, 0xd0, 0xce, 0xc4]);
        assert_eq!(encode_text("a中", "ascii"), b"a?");
        assert_eq!(encode_text("中", "utf-8"), "中".as_bytes());
        assert_eq!(encode_text("中", "unknown"), "中".as_bytes());
    }
}
