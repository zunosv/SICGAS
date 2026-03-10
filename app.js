let bombas   = [];
let facturas = [];

// ── LEER PDF ──────────────────────────────────────────────────────────────────
async function leerPDF() {
  const file = document.getElementById("pdfFile").files[0];
  if (!file) { alert("Selecciona un archivo PDF primero."); return; }
  setStatus("Leyendo PDF…");

  const reader = new FileReader();
  reader.onload = async function () {
    const typedarray = new Uint8Array(this.result);
    const pdf = await pdfjsLib.getDocument(typedarray).promise;

    let paginas = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page    = await pdf.getPage(i);
      const content = await page.getTextContent();

      const lineMap = {};
      content.items.forEach(item => {
        const y = Math.round(item.transform[5]);
        if (!lineMap[y]) lineMap[y] = [];
        lineMap[y].push({ x: item.transform[4], str: item.str });
      });

      const ySorted = Object.keys(lineMap).map(Number).sort((a, b) => b - a);
      const lines   = ySorted.map(y =>
        lineMap[y].sort((a, b) => a.x - b.x).map(i => i.str).join(" ")
      );
      paginas.push(lines);
    }

    procesarPaginas(paginas);
  };
  reader.readAsArrayBuffer(file);
}

// ── PARSER PRINCIPAL ──────────────────────────────────────────────────────────
function procesarPaginas(paginas) {
  bombas = [];
  let productoActual = "";

  paginas.forEach(lineas => {
    lineas.forEach(linea => {
      const lu = linea.toUpperCase();

      if (/\bSUPER\b/.test(lu))   { productoActual = "S"; return; }
      if (/\bREGULAR\b/.test(lu)) { productoActual = "R"; return; }
      if (/\bDIESEL\b/.test(lu))  { productoActual = "D"; return; }

      if (/BOMBA|CALIBRA|GALONES|LECTURA|VENTAS|DIFERENCIA|PRECIO|USD/i.test(linea)) return;
      if (!productoActual) return;

      const nums = linea.match(/-?\d+\.?\d*/g);
      if (!nums || nums.length < 2) return;

      const bomba  = parseInt(nums[0]);
      const usdDif = parseFloat(nums[nums.length - 1]);

      if (isNaN(bomba) || bomba <= 0 || bomba > 50) return;
      if (isNaN(usdDif)) return;

      bombas.push({ bomba, sabor: productoActual, monto: usdDif });
    });
  });

  if (bombas.length === 0) {
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

// ── GENERAR FACTURAS (BAC primero, luego Efectivo) ────────────────────────────
function generarFacturas() {
  if (!bombas.length) { alert("Primero lee el PDF."); return; }

  const bacInput  = parseFloat(document.getElementById("montoBAC").value) || 0;
  facturas        = [];
  let bacRestante = Math.round(bacInput * 100) / 100;

  const RESERVA_SABOR = 200.00; // $200 sin facturar por sabor

  // Calcular cuánto facturar por sabor (total positivo - $200 de reserva)
  const totalPorSabor = { S: 0, R: 0, D: 0 };
  bombas.forEach(b => { if (b.monto > 0) totalPorSabor[b.sabor] += b.monto; });

  const facturablePorSabor = {};
  ["S","R","D"].forEach(s => {
    facturablePorSabor[s] = Math.max(0, Math.round((totalPorSabor[s] - RESERVA_SABOR) * 100) / 100);
  });

  // Cuánto queda disponible por sabor para ir consumiendo bomba a bomba
  const restantePorSabor = { ...facturablePorSabor };

  const totalFacturable = Object.values(facturablePorSabor).reduce((s,v)=>s+v,0);

  if (bacRestante > totalFacturable + 0.01) {
    alert(`⚠️ El monto BAC ($${bacRestante.toFixed(2)}) supera el total facturable ($${totalFacturable.toFixed(2)})`);
    return;
  }

  bombas.forEach(b => {
    // Monto real de esta bomba limitado a lo que queda facturable de su sabor
    let monto = Math.min(
      Math.round(b.monto * 100) / 100,
      restantePorSabor[b.sabor]
    );
    monto = Math.round(monto * 100) / 100;
    if (monto <= 0) return;

    restantePorSabor[b.sabor] = Math.round((restantePorSabor[b.sabor] - monto) * 100) / 100;

    // ── Porción BAC ──────────────────────────────────────────────────────────
    if (bacRestante > 0) {
      let bacBomba = Math.min(monto, bacRestante);
      bacBomba     = Math.round(bacBomba * 100) / 100;
      bacRestante  = Math.round((bacRestante - bacBomba) * 100) / 100;

      let tmp = bacBomba;
      while (tmp > 200) {
        facturas.push({ bomba: b.bomba, sabor: b.sabor, monto: 200.00, metodo: "B" });
        tmp = Math.round((tmp - 200) * 100) / 100;
      }
      if (tmp > 0) facturas.push({ bomba: b.bomba, sabor: b.sabor, monto: tmp, metodo: "B" });

      monto = Math.round((monto - bacBomba) * 100) / 100;
    }

    // ── Porción Efectivo ─────────────────────────────────────────────────────
    if (monto <= 0) return;
    let tmp = monto;
    while (tmp > 200) {
      facturas.push({ bomba: b.bomba, sabor: b.sabor, monto: 200.00, metodo: "E" });
      tmp = Math.round((tmp - 200) * 100) / 100;
    }
    if (tmp > 0) facturas.push({ bomba: b.bomba, sabor: b.sabor, monto: tmp, metodo: "E" });
  });

  const totalB  = facturas.filter(f=>f.metodo==="B").reduce((s,f)=>s+f.monto,0);
  const totalE  = facturas.filter(f=>f.metodo==="E").reduce((s,f)=>s+f.monto,0);
  const resS    = Math.min(totalPorSabor["S"], RESERVA_SABOR).toFixed(2);
  const resR    = Math.min(totalPorSabor["R"], RESERVA_SABOR).toFixed(2);
  const resD    = Math.min(totalPorSabor["D"], RESERVA_SABOR).toFixed(2);
  setStatus(`✅ ${facturas.length} facturas — BAC: $${totalB.toFixed(2)} | Efectivo: $${totalE.toFixed(2)} | Sin facturar → S:$${resS} R:$${resR} D:$${resD}`);
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
    const total = grupos[tipo].reduce((s,f) => s + f.monto, 0);
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
      html += `<tr class="${f.metodo==='B'?'fila-bac':'fila-ef'}">
        <td>Bomba ${f.bomba}</td>
        <td><span class="badge ${f.metodo==='B'?'bac':'ef'}">${f.metodo==='B'?'BAC':'Efectivo'}</span></td>
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
  facturas.forEach(f => {
    txt += `${f.bomba},${f.sabor},${f.monto.toFixed(2)},${f.metodo}\n`;
  });

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
