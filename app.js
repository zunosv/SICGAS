let bombas   = [];
let facturas = [];

// ── LEER PDF ──────────────────────────────────────────────────────────────────
async function leerPDF() {
  const file = document.getElementById("pdfFile").files[0];
  if (!file) { alert("Selecciona un archivo PDF primero."); return; }

  setStatus("📄 Cargando archivo…");

  // FileReader funciona en todos los navegadores incluyendo Android
  const typedarray = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(new Uint8Array(e.target.result));
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsArrayBuffer(file);
  });

  setStatus("🔍 Procesando PDF…");

  let pdf;
  try {
    pdf = await pdfjsLib.getDocument({ data: typedarray }).promise;
  } catch (e) {
    setStatus("❌ Error al abrir PDF: " + e.message);
    return;
  }

  setStatus(`📑 ${pdf.numPages} páginas encontradas, extrayendo texto…`);

  const allItems = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page    = await pdf.getPage(p);
    const vp      = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const baseY   = (p - 1) * 5000;

    for (const item of content.items) {
      const str = (item.str || "").trim();
      if (!str) continue;
      allItems.push({
        x: item.transform[4],
        y: (vp.height - item.transform[5]) + baseY,
        str
      });
    }
  }

  setStatus(`🧩 ${allItems.length} elementos extraídos, analizando…`);
  procesarItems(allItems);
}

// ── PARSER ────────────────────────────────────────────────────────────────────
function procesarItems(allItems) {
  bombas = [];

  // Agrupar en filas por proximidad Y (±8px)
  const filas = [];
  for (const item of allItems) {
    let fila = null;
    for (const f of filas) {
      if (Math.abs(f.y - item.y) <= 8) { fila = f; break; }
    }
    if (!fila) { fila = { y: item.y, items: [] }; filas.push(fila); }
    fila.items.push(item);
  }

  filas.sort((a, b) => a.y - b.y);

  let producto = "";

  for (const fila of filas) {
    fila.items.sort((a, b) => a.x - b.x);
    const texto = fila.items.map(i => i.str).join(" ").toUpperCase();

    if (texto.includes("SUPER")   && !texto.includes("AUTO")) { producto = "S"; continue; }
    if (texto.includes("REGULAR") && !texto.includes("AUTO")) { producto = "R"; continue; }
    if (texto.includes("DIESEL")  && !texto.includes("AUTO")) { producto = "D"; continue; }

    if (!producto) continue;

    const tieneAuto = fila.items.some(i => i.x >= 70 && i.x <= 115 && /auto/i.test(i.str));
    if (!tieneAuto) continue;

    const idItem = fila.items.find(i => i.x <= 65 && /^\d+$/.test(i.str));
    if (!idItem) continue;
    const bomba = parseInt(idItem.str, 10);
    if (bomba < 1 || bomba > 50) continue;

    const difItems = fila.items.filter(i => i.x >= 700);
    if (!difItems.length) continue;
    difItems.sort((a, b) => b.x - a.x);
    const monto = parseFloat(difItems[0].str.replace(/[$,\s]/g, ""));
    if (isNaN(monto)) continue;

    bombas.push({ bomba, sabor: producto, monto });
  }

  if (!bombas.length) {
    setStatus("⚠️ No se detectaron bombas. Verifica el PDF.");
  } else {
    setStatus(`✅ ${bombas.length} bombas detectadas.`);
  }
  mostrarBombas();
}

// ── MOSTRAR BOMBAS ────────────────────────────────────────────────────────────
function mostrarBombas() {
  const grupos  = { S: [], R: [], D: [] };
  const nombres = { S: "⛽ SUPER", R: "🔵 REGULAR", D: "🟡 DIESEL" };
  bombas.forEach(b => grupos[b.sabor].push(b));

  let html = "";
  ["S","R","D"].forEach(tipo => {
    if (!grupos[tipo].length) return;
    html += `<div class="grupo">
      <h3>${nombres[tipo]}</h3>
      <table>
        <thead><tr><th>Bomba</th><th>USD Diferencia</th></tr></thead>
        <tbody>`;
    grupos[tipo].forEach(b => {
      const cls = b.monto < 0 ? "negativo" : "";
      html += `<tr class="${cls}"><td>Bomba ${b.bomba}</td><td>$${b.monto.toFixed(2)}</td></tr>`;
    });
    html += `</tbody></table></div>`;
  });

  document.getElementById("resultado").innerHTML = html;
}

// ── GENERAR FACTURAS ──────────────────────────────────────────────────────────
function generarFacturas(soloPositivas = false) {
  if (!bombas.length) { alert("Primero lee el PDF."); return; }

  const bacInput  = parseFloat(document.getElementById("montoBAC").value) || 0;
  facturas        = [];
  let bacRestante = Math.round(bacInput * 100) / 100;
  const RESERVA   = 200.00;

  const bombasAUsar   = soloPositivas ? bombas.filter(b => b.monto > 0) : bombas;
  const totalPorSabor = { S: 0, R: 0, D: 0 };
  bombasAUsar.forEach(b => { if (b.monto > 0) totalPorSabor[b.sabor] += b.monto; });

  const facturable = {};
  ["S","R","D"].forEach(s => {
    facturable[s] = Math.max(0, Math.round((totalPorSabor[s] - RESERVA) * 100) / 100);
  });
  const restante  = { ...facturable };
  const totalFact = Object.values(facturable).reduce((s,v) => s+v, 0);

  if (bacRestante > totalFact + 0.01) {
    alert(`⚠️ El monto BAC ($${bacRestante.toFixed(2)}) supera el total facturable ($${totalFact.toFixed(2)})`);
    return;
  }

  bombasAUsar.forEach(b => {
    let monto = Math.min(Math.round(b.monto * 100) / 100, restante[b.sabor]);
    monto = Math.round(monto * 100) / 100;
    if (monto <= 0) return;
    restante[b.sabor] = Math.round((restante[b.sabor] - monto) * 100) / 100;

    if (bacRestante > 0) {
      let bac = Math.min(monto, bacRestante);
      bac         = Math.round(bac * 100) / 100;
      bacRestante = Math.round((bacRestante - bac) * 100) / 100;
      let tmp = bac;
      while (tmp > 200) { facturas.push({ bomba: b.bomba, sabor: b.sabor, monto: 200, metodo: "B" }); tmp = Math.round((tmp-200)*100)/100; }
      if (tmp > 0) facturas.push({ bomba: b.bomba, sabor: b.sabor, monto: tmp, metodo: "B" });
      monto = Math.round((monto - bac) * 100) / 100;
    }

    if (monto <= 0) return;
    let tmp = monto;
    while (tmp > 200) { facturas.push({ bomba: b.bomba, sabor: b.sabor, monto: 200, metodo: "E" }); tmp = Math.round((tmp-200)*100)/100; }
    if (tmp > 0) facturas.push({ bomba: b.bomba, sabor: b.sabor, monto: tmp, metodo: "E" });
  });

  const tB = facturas.filter(f=>f.metodo==="B").reduce((s,f)=>s+f.monto,0);
  const tE = facturas.filter(f=>f.metodo==="E").reduce((s,f)=>s+f.monto,0);
  const rS = Math.min(totalPorSabor.S, RESERVA).toFixed(2);
  const rR = Math.min(totalPorSabor.R, RESERVA).toFixed(2);
  const rD = Math.min(totalPorSabor.D, RESERVA).toFixed(2);
  setStatus(`✅ ${facturas.length} facturas${soloPositivas?" [Solo+]":""} — BAC:$${tB.toFixed(2)} | EF:$${tE.toFixed(2)} | Sin facturar→ S:$${rS} R:$${rR} D:$${rD}`);
  mostrarFacturas();
}

// ── MOSTRAR FACTURAS ──────────────────────────────────────────────────────────
function mostrarFacturas() {
  const grupos  = { S: [], R: [], D: [] };
  const nombres = { S: "⛽ SUPER", R: "🔵 REGULAR", D: "🟡 DIESEL" };
  facturas.forEach(f => grupos[f.sabor].push(f));

  let html = "";
  ["S","R","D"].forEach(tipo => {
    if (!grupos[tipo].length) return;
    const total = grupos[tipo].reduce((s,f) => s+f.monto, 0);
    const cntB  = grupos[tipo].filter(f=>f.metodo==="B").length;
    const cntE  = grupos[tipo].filter(f=>f.metodo==="E").length;
    html += `<div class="grupo">
      <h3>${nombres[tipo]} — ${grupos[tipo].length} facturas · $${total.toFixed(2)}
        <span class="badge bac">BAC ${cntB}</span>
        <span class="badge ef">EF ${cntE}</span>
      </h3>
      <table>
        <thead><tr><th>Bomba</th><th>Método</th><th>Monto</th></tr></thead>
        <tbody>`;
    grupos[tipo].forEach(f => {
      html += `<tr class="${f.metodo==="B"?"fila-bac":"fila-ef"}">
        <td>Bomba ${f.bomba}</td>
        <td><span class="badge ${f.metodo==="B"?"bac":"ef"}">${f.metodo==="B"?"BAC":"Efectivo"}</span></td>
        <td>$${f.monto.toFixed(2)}</td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
  });

  document.getElementById("resultado").innerHTML = html;
}

// ── EXPORTAR TXT ──────────────────────────────────────────────────────────────
function exportar() {
  if (!facturas.length) { alert("Primero genera las facturas."); return; }
  let txt = "";
  facturas.forEach(f => { txt += `${f.bomba},${f.sabor},${f.monto.toFixed(2)},${f.metodo}\n`; });
  const blob = new Blob([txt], { type: "text/plain" });
  const a    = document.createElement("a");
  a.href     = URL.createObjectURL(blob);
  a.download = "facturas.txt";
  a.click();
}

// ── UTILS ─────────────────────────────────────────────────────────────────────
function setStatus(msg) {
  document.getElementById("status").textContent = msg;
}
