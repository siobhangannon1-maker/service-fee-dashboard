export async function parsePdfText(buffer: Buffer) {
  try {
    console.log("Parsing PDF buffer size:", buffer.length);

    // Avoid Next.js bundling pdf-parse at route compile time.
    // This uses Node's runtime require only.
    const runtimeRequire = eval("require");
    const pdfParseModule = runtimeRequire("pdf-parse");

    if (typeof pdfParseModule.PDFParse !== "function") {
      console.error("pdf-parse module keys:", Object.keys(pdfParseModule));
      return "";
    }

    const parser = new pdfParseModule.PDFParse({
      data: buffer,
    });

    const result = await parser.getText();

    await parser.destroy();

    const text = result.text?.trim() || "";

    console.log("PDF extracted text length:", text.length);

    return text;
  } catch (error) {
    console.error("PDF parse failed:", error);
    return "";
  }
}