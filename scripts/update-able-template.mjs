import PizZip from 'pizzip';
import { readFile, writeFile } from 'node:fs/promises';

const file = new URL('../output/ABLE_Meeting_Minutes_Template.docx', import.meta.url);
const zip = new PizZip(await readFile(file));
const prior = zip.file('word/document.xml').asText();
const section = prior.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/)?.[0];
if (!section) throw new Error('The existing template has no document section settings.');

const text = value => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const run = (value, {bold=false, color='000000', size=21}={}) => `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft JhengHei"/>${bold?'<w:b/>':''}<w:color w:val="${color}"/><w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${text(value)}</w:t></w:r>`;
const paragraph = (value, style={}) => `<w:p><w:pPr><w:spacing w:before="${style.before ?? 0}" w:after="${style.after ?? 0}" w:line="${style.line ?? 293}" w:lineRule="auto"/><w:jc w:val="${style.align ?? 'left'}"/></w:pPr>${run(value, style)}</w:p>`;
const borders = weight => `<w:tcBorders><w:top w:val="single" w:sz="${weight}" w:color="000000"/><w:bottom w:val="single" w:sz="${weight}" w:color="000000"/><w:start w:val="single" w:sz="${weight}" w:color="000000"/><w:end w:val="single" w:sz="${weight}" w:color="000000"/></w:tcBorders>`;
const cell = (value, width, {fill='', bold=false, color='000000', size=21, valign='top'}={}) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:vAlign w:val="${valign}"/><w:tcMar><w:top w:w="90" w:type="dxa"/><w:start w:w="105" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:end w:w="105" w:type="dxa"/></w:tcMar>${borders(5)}${fill?`<w:shd w:fill="${fill}"/>`:''}</w:tcPr>${paragraph(value,{bold,color,size})}</w:tc>`;
const table = (columns, rows, {header=false}={}) => `<w:tbl><w:tblPr><w:tblW w:w="${columns.reduce((sum,n)=>sum+n,0)}" w:type="dxa"/><w:jc w:val="center"/><w:tblLayout w:type="fixed"/><w:tblLook w:firstColumn="1" w:firstRow="1" w:lastColumn="0" w:lastRow="0" w:noHBand="0" w:noVBand="1" w:val="04A0"/></w:tblPr><w:tblGrid>${columns.map(width=>`<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${rows.map((cells,index)=>`<w:tr><w:trPr>${header&&index===0?'<w:tblHeader w:val="true"/>':''}</w:trPr>${cells.join('')}</w:tr>`).join('')}</w:tbl>`;

const metadata = table([1984,7314], [
  [cell('會議號碼',1984,{fill:'E2E2E2'}),cell('{referenceNumber}',7314)],
  [cell('會議名稱',1984,{fill:'E2E2E2'}),cell('{title}',7314)],
  [cell('會議日期',1984,{fill:'E2E2E2'}),cell('{date}',7314)],
  [cell('時間',1984,{fill:'E2E2E2'}),cell('{time}',7314)],
  [cell('出席者',1984,{fill:'E2E2E2',valign:'center'}),cell('{attendees}',7314,{valign:'center'})]
]);
const itemHeader = [
  cell('項目描述',5670,{bold:true,color:'4A4A4A'}),
  cell('跟進事項',2336,{bold:true,color:'4A4A4A'}),
  cell('負責人',1304,{bold:true,color:'4A4A4A'})
];
const itemRow = [
  cell('{#items}{number}. {text}',5670),
  cell('{dueDate}',2336),
  `<w:tc><w:tcPr><w:tcW w:w="1304" w:type="dxa"/><w:vAlign w:val="top"/><w:tcMar><w:top w:w="90" w:type="dxa"/><w:start w:w="105" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:end w:w="105" w:type="dxa"/></w:tcMar>${borders(5)}</w:tcPr><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="293" w:lineRule="auto"/><w:jc w:val="left"/></w:pPr>${run('{owner}')}${run('{/items}',{color:'FFFFFF',size:2})}</w:p></w:tc>`
];
const items = table([5670,2336,1304],[itemHeader,itemRow],{header:true});
const body = [
  paragraph('{title}',{bold:true,color:'4A4A4A',size:32,align:'center',before:100,after:320}),
  metadata,
  paragraph('會議概要',{bold:true,color:'4A4A4A',size:24,before:280,after:170}),
  paragraph('{summary}',{size:22,after:260}),
  items
].join('');

zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" mc:Ignorable="w14 wp14"><w:body>${body}${section}</w:body></w:document>`);
await writeFile(file, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
