const fs = require("fs");
const path = require("path");

async function testPdf() {
  try {
    const pdfParseModule = require("pdf-parse");

    const pdfPath = path.join(__dirname, "Karoly.pdf");

    console.log("Reading PDF from:", pdfPath);

    const buffer = fs.readFileSync(pdfPath);

    console.log("PDF size:", buffer.length);

    console.log("pdf-parse keys:");
    console.log(Object.keys(pdfParseModule));

    let text = "";

    if (typeof pdfParseModule.PDFParse === "function") {
      console.log("\nUsing PDFParse class API");

      const parser = new pdfParseModule.PDFParse({
        data: buffer,
      });

      const result = await parser.getText();

      await parser.destroy();

      text = result.text || "";
    } else if (typeof pdfParseModule === "function") {
      console.log("\nUsing classic function API");

      const result = await pdfParseModule(buffer);

      text = result.text || "";
    } else {
      throw new Error("Unknown pdf-parse export format");
    }

    console.log("\n====================");
    console.log("TEXT LENGTH:");
    console.log(text.length);

    console.log("\n====================");
    console.log("TEXT PREVIEW:");
    console.log(text.slice(0, 4000));
  } catch (error) {
    console.error("PDF PARSE ERROR:");
    console.error(error);
  }
}

testPdf();