let bombas   = [];
let facturas = [];

// ── LEER PDF CON IA (Claude API) ──────────────────────────────────────────────
async function leerPDF() {
  const file = document.getElementById("pdfFile").files[0];
  if (!file) { alert("Selecciona un archivo PDF primero."); return; }
  setStatus("🤖 Analizando PDF con IA…");

  // Convertir PDF a base64
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(",")[1]);
    reader.onerror = () => reject(new Error("Error al leer el archivo"));
    reader.readAsDataURL(file);
  });

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: base64 }
            },
            {
              type: "text",
              text: `Analiza este reporte de lecturas de bomba. 
Extrae TODAS las filas de bombas (las que tienen "Auto Serv.").
Para cada fila necesito:
- ID de bomba (número en la primera columna: 1, 2, 3... etc)
- Tipo de combustible de su sección: SUPER, REGULAR o DIESEL
- El valor de la columna "DIF USD LECT. DISP." (última columna del reporte, puede ser $0.00 o un valor con $)

Responde ÚNICAMENTE con un JSON válido, sin texto adicional, sin bloques de código, sin explicaciones.
Formato exacto:
[{"bomba":1,"sabor":"S","monto":0.00},{"bomba":2,"sabor":"S","monto":5.50}]
Donde sabor: "S"=SUPER, "R"=REGULAR, "D"=DIESEL
El monto es el número sin el símbolo $, puede ser negativo.`
            }
          ]
        }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || `Error API: ${response.status}`);
    }

    // Extraer texto de la respuesta
    const texto = data.content
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("")
      .trim();

    // Limpiar posibles backticks/markdown y parsear JSON
    const jsonLimpio = texto.replace(/```json|```/g, "").trim();
    const resultado  = JSON.parse(jsonLimpio);

    if (!Array.isArray(resultado) || resultado.length === 0) {
      throw new Error("La IA no devolvió datos válidos.");
    }

    bombas = resultado.map(b => ({
      bomba:  parseInt(b.bomba, 10),
      sabor:  b.sabor,
      monto:  parseFloat(b.monto)
    })).filter(b => !isNaN(b.bomba) && !isNaN(b.monto) && ["S","R","D"].includes(b.sabor));

    if (bombas.length === 0) {
      setStatus("⚠️ La IA no encontró bombas en el PDF.");
    } else {
      setStatus(`✅ ${bombas.length} bombas detectadas por IA.`);
    }

    mostrarBombas();

  } catch (err) {
    console.error(err);
    setStatus(`❌ Error: ${err.message}`);
  }
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
function generarFacturas(soloPositivas = false) {
  if (!bombas.length) { alert("Primero lee el PDF."); return; }

  const bacInput  = parseFloat(document.getElementById("montoBAC").value) || 0;
  facturas        = [];
  let bacRestante = Math.round(bacInput * 100) / 100;

  const RESERVA_SABOR = 200.00; // $200 sin facturar por sabor

  // Calcular cuánto facturar por sabor (total positivo - $200 de reserva)
  const bombasAUsar = soloPositivas ? bombas.filter(b => b.monto > 0) : bombas;
  const totalPorSabor = { S: 0, R: 0, D: 0 };
  bombasAUsar.forEach(b => { if (b.monto > 0) totalPorSabor[b.sabor] += b.monto; });

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

  bombasAUsar.forEach(b => {
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
  const modo = soloPositivas ? ' [Solo positivas]' : '';
  setStatus(`✅ ${facturas.length} facturas${modo} — BAC: $${totalB.toFixed(2)} | Efectivo: $${totalE.toFixed(2)} | Sin facturar → S:$${resS} R:$${resR} D:$${resD}`);
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
