import * as OpenCC from 'opencc-js';

const convert = OpenCC.Converter({ from: 'cn', to: 'hk' });
export const traditional = text => convert(String(text ?? ''));

// Canonical text is used both by the model and evidence validation. Keep the
// provider text separately so script conversion never destroys the source.
export function traditionalSegments(segments) {
  return segments.map(segment => {
    const text = traditional(segment.text);
    return text === segment.text ? { ...segment } : {
      ...segment, text, originalText: segment.originalText ?? segment.text,
      textLocale: 'zh-Hant-HK'
    };
  });
}

export function traditionalMinutes(content) {
  return {
    ...content,
    summary: traditional(content.summary),
    attendees: (content.attendees || []).map(traditional),
    nextMeeting: traditional(content.nextMeeting),
    items: (content.items || []).map(item => ({
      ...item, text: traditional(item.text), quote: traditional(item.quote),
      owner: traditional(item.owner)
    }))
  };
}
