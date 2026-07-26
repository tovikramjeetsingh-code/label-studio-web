// Direct-to-printer via QZ Tray. QZ Tray is a small free app installed on each
// machine; it exposes a secure localhost WebSocket that this page talks to, so a
// press of "Print" sends the 60x83mm label straight to the label printer.
//
// Signing: this is a static site with no backend, so we run QZ in UNSIGNED mode
// (empty certificate + signature). QZ then shows a one-time "Allow" dialog per
// machine — tick "Remember" and printing is silent thereafter. (A private key
// can't be shipped in a public page, so we intentionally don't sign.)
(function () {
  const PRINTER_KEY = "labelStudioPrinter_v1";

  function available() { return typeof qz !== "undefined"; }
  function isConnected() { return available() && qz.websocket.isActive(); }

  function _configureUnsigned() {
    // no certificate -> unsigned
    qz.security.setCertificatePromise((resolve) => resolve());
    // no signature -> unsigned (QZ prompts once; user can "remember")
    qz.security.setSignaturePromise(() => (resolve) => resolve());
  }

  let _configured = false;
  async function connect() {
    if (!available()) throw new Error("QZ Tray library not loaded.");
    if (!_configured) { _configureUnsigned(); _configured = true; }
    if (!qz.websocket.isActive()) {
      await qz.websocket.connect();   // tries secure wss://localhost:8181 first
    }
    return true;
  }

  async function listPrinters() {
    const printers = await qz.printers.find();
    return Array.isArray(printers) ? printers : [printers];
  }
  async function defaultPrinter() { try { return await qz.printers.getDefault(); } catch (e) { return null; } }

  function savedPrinter() { try { return localStorage.getItem(PRINTER_KEY) || ""; } catch (e) { return ""; } }
  function savePrinter(name) { try { localStorage.setItem(PRINTER_KEY, name); } catch (e) {} }

  function _config(printer, size, copies) {
    return qz.configs.create(printer, {
      units: "mm",
      size: { width: size.w, height: size.h },
      margins: 0,
      orientation: size.w > size.h ? "landscape" : "portrait",
      colorType: "grayscale",
      scaleContent: true,
      rasterize: false,          // keep the PDF vector-sharp
      interpolation: "nearest",
      copies: copies && copies > 1 ? copies : 1,
    });
  }

  function _pdfData(doc) {
    const b64 = doc.output("datauristring").split(",")[1];
    return [{ type: "pixel", format: "pdf", flavor: "base64", data: b64 }];
  }

  // Print a jsPDF doc (single- or multi-page) as ONE job at the given mm size.
  async function printDoc(doc, size, printer, copies) {
    if (!isConnected()) await connect();
    const p = printer || savedPrinter();
    if (!p) throw new Error("No printer selected.");
    await qz.print(_config(p, size, copies), _pdfData(doc));
  }

  // Send raw printer-language commands (e.g. TSPL for a TSC printer).
  async function printRaw(command, printer) {
    if (!isConnected()) await connect();
    const p = printer || savedPrinter();
    if (!p) throw new Error("No printer selected.");
    await qz.print(qz.configs.create(p), [{ type: "raw", format: "command", flavor: "plain", data: command }]);
  }

  async function disconnect() { try { if (isConnected()) await qz.websocket.disconnect(); } catch (e) {} }

  window.LabelPrint = {
    available, isConnected, connect, disconnect,
    listPrinters, defaultPrinter, savedPrinter, savePrinter,
    printDoc, printRaw,
  };
})();
