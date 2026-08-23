const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");

const DEFAULT_TEMPLATE_PATH = path.join(__dirname, "assets", "documents", "FLP-TEMPLATE-EXTRACT-REPORT.docx");
const FONT = "Bookman Old Style";
const FONT_SIZE = 28; // Word half-points: 14 pt.
const PAGE_WIDTH_DXA = 9360;

function escapeXml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function runXml(text, options = {}) {
  const color = options.color || "17324D";
  const properties = [
    `<w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:eastAsia="${FONT}" w:cs="${FONT}"/>`,
    `<w:sz w:val="${FONT_SIZE}"/><w:szCs w:val="${FONT_SIZE}"/>`,
    `<w:color w:val="${color}"/>`
  ];
  if (options.bold) properties.push("<w:b/><w:bCs/>");
  if (options.italic) properties.push("<w:i/><w:iCs/>");
  return `<w:r><w:rPr>${properties.join("")}</w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function paragraphXml(text, options = {}) {
  const alignment = options.align || "left";
  const before = Number(options.before == null ? 0 : options.before);
  const after = Number(options.after == null ? 120 : options.after);
  const keep = options.keepNext ? "<w:keepNext/>" : "";
  return `<w:p><w:pPr>${keep}<w:jc w:val="${alignment}"/><w:spacing w:before="${before}" w:after="${after}" w:line="336" w:lineRule="auto"/></w:pPr>${runXml(text, options)}</w:p>`;
}

function sectionHeadingXml(text) {
  return paragraphXml(String(text || "").toUpperCase(), {
    bold: true,
    color: "0B4F87",
    before: 200,
    after: 90,
    keepNext: true
  });
}

function cellXml(text, width, options = {}) {
  const fill = options.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${options.fill}"/>` : "";
  const vertical = `<w:vAlign w:val="center"/>`;
  const cellMargins = `<w:tcMar><w:top w:w="120" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="120" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tcMar>`;
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${vertical}${fill}${cellMargins}</w:tcPr>${paragraphXml(text, {
    bold: Boolean(options.bold),
    color: options.color || "17324D",
    align: options.align || "left",
    after: 0
  })}</w:tc>`;
}

function tableXml(rows, widths, options = {}) {
  const grid = widths.map((width) => `<w:gridCol w:w="${width}"/>`).join("");
  const borders = `<w:tblBorders><w:top w:val="single" w:sz="6" w:space="0" w:color="B8CAD5"/><w:left w:val="single" w:sz="6" w:space="0" w:color="B8CAD5"/><w:bottom w:val="single" w:sz="6" w:space="0" w:color="B8CAD5"/><w:right w:val="single" w:sz="6" w:space="0" w:color="B8CAD5"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="D7E3E9"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="D7E3E9"/></w:tblBorders>`;
  const body = rows.map((row, rowIndex) => {
    const isHeader = Boolean(options.header && rowIndex === 0);
    const repeat = isHeader ? "<w:tblHeader/>" : "";
    const cells = row.map((value, columnIndex) => cellXml(value, widths[columnIndex], {
      bold: isHeader || Boolean(options.firstColumnBold && columnIndex === 0),
      color: isHeader ? "FFFFFF" : "17324D",
      fill: isHeader ? "0B4F87" : (options.firstColumnBold && columnIndex === 0 ? "EAF3F8" : (rowIndex % 2 === 0 ? "F7FAFC" : "FFFFFF")),
      align: isHeader ? "center" : (columnIndex === 0 && options.firstColumnBold ? "left" : "left")
    })).join("");
    return `<w:tr><w:trPr>${repeat}<w:cantSplit/></w:trPr>${cells}</w:tr>`;
  }).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="${PAGE_WIDTH_DXA}" w:type="dxa"/><w:tblInd w:w="120" w:type="dxa"/><w:tblLayout w:type="fixed"/>${borders}</w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl>`;
}

function normalizeRows(rows, emptyRow) {
  const source = Array.isArray(rows) ? rows : [];
  if (source.length) return source;
  return emptyRow && typeof emptyRow === "object" ? [emptyRow] : [];
}

function generatedContentXml({ title, rows, emptyRow }) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const reportRows = normalizeRows(sourceRows, emptyRow);
  const headers = Object.keys(reportRows[0] || {});
  const generatedAt = new Intl.DateTimeFormat("en-PH", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Manila"
  }).format(new Date());

  const parts = [
    paragraphXml(String(title || "PROJECT I-TRACK REPORT").toUpperCase(), { bold: true, align: "center", before: 220, after: 80 }),
    paragraphXml("Generated Report from Project i-Track Website", { italic: true, align: "center", color: "4B6171", after: 220 }),
    sectionHeadingXml("Report Information"),
    tableXml([
      ["FEATURE", String(title || "Project i-Track Report")],
      ["DATE GENERATED", generatedAt],
      ["TOTAL RECORDS", String(sourceRows.length)]
    ], [2600, 6760], { firstColumnBold: true }),
    sectionHeadingXml("Report Data")
  ];

  if (!headers.length || !sourceRows.length) {
    parts.push(paragraphXml("No records were available when this report was generated.", { italic: true, color: "4B6171", after: 120 }));
    return parts.join("");
  }

  if (headers.length <= 5) {
    const width = Math.floor(PAGE_WIDTH_DXA / headers.length);
    const widths = headers.map((_, index) => index === headers.length - 1 ? PAGE_WIDTH_DXA - width * (headers.length - 1) : width);
    parts.push(tableXml([
      headers.map((header) => String(header).replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase()),
      ...sourceRows.map((record) => headers.map((header) => String(record[header] == null ? "" : record[header])))
    ], widths, { header: true }));
  } else {
    sourceRows.forEach((record, index) => {
      parts.push(sectionHeadingXml(`Record ${index + 1}`));
      parts.push(tableXml(headers.map((header) => [
        String(header).replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase(),
        String(record[header] == null ? "" : record[header])
      ]), [3000, 6360], { firstColumnBold: true }));
    });
  }

  return parts.join("");
}

async function createTemplatedDocxBuffer({ title, rows, emptyRow, templatePath = DEFAULT_TEMPLATE_PATH }) {
  const templateBuffer = await fs.promises.readFile(templatePath);
  const zip = await JSZip.loadAsync(templateBuffer);
  const documentPart = zip.file("word/document.xml");
  if (!documentPart) throw new Error("The FLP report template is missing word/document.xml.");

  const sourceXml = await documentPart.async("string");
  const content = generatedContentXml({ title, rows, emptyRow });
  const sectionIndex = sourceXml.lastIndexOf("<w:sectPr");
  const bodyEndIndex = sourceXml.lastIndexOf("</w:body>");
  const insertionIndex = sectionIndex >= 0 ? sectionIndex : bodyEndIndex;
  if (insertionIndex < 0) throw new Error("The FLP report template has an invalid document body.");

  const finalXml = `${sourceXml.slice(0, insertionIndex)}${content}${sourceXml.slice(insertionIndex)}`;
  zip.file("word/document.xml", finalXml);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

module.exports = { createTemplatedDocxBuffer, DEFAULT_TEMPLATE_PATH };
