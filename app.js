"use strict";

let formRows = [];
let bankRows = [];
let results = [];
let activeFilter = "Todos";

const $ = (id) => document.getElementById(id);

/*
 * ALIAS DE COLUMNAS
 * Permiten reconocer variantes comunes de los encabezados.
 */
const aliases = {
  fecha: ["Fecha"],
  manzana: ["Manzana", "Mz"],
  villa: ["Villa", "Casa"],
  propietario: ["Propietario", "Nombre propietario"],
  tipo: ["Tipo"],
  anio: ["Año", "Ano", "Anio", "Year"],
  mes: ["Mes", "Month"],
  valor: ["Valor", "Importe", "Monto"],
  comprobante: ["Comprobante"],
  fechaReal: ["Fecha real"],
  fechaContable: ["Fecha contable"],
  tipoBanco: ["Tipo"],
  nut: ["NUT"],
  concepto: ["Concepto"],
  descripcion: ["Descripción", "Descripcion"],
  referencia: ["Referencia adicional"],
  opcion: ["OPCION", "Opción"],
  comentarios: ["Comentarios"],
};

function norm(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value) {
  return norm(value).replace(/\s/g, "");
}

function findKey(row, names) {
  const keys = Object.keys(row);

  for (const name of names) {
    const key = keys.find((k) => norm(k) === norm(name));
    if (key) return key;
  }

  for (const name of names) {
    const key = keys.find((k) => norm(k).includes(norm(name)));
    if (key) return key;
  }

  return null;
}

function get(row, alias) {
  const key = findKey(row, aliases[alias] || [alias]);
  return key ? row[key] : "";
}

function num(value) {
  if (typeof value === "number") return value;

  let s = String(value ?? "")
    .trim()
    .replace(/\$/g, "")
    .replace(/\s/g, "");

  if (!s) return 0;

  if (s.includes(",") && s.includes(".")) {
    s =
      s.lastIndexOf(",") > s.lastIndexOf(".")
        ? s.replace(/\./g, "").replace(",", ".")
        : s.replace(/,/g, "");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }

  const n = Number(s.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function money(value) {
  return new Intl.NumberFormat("es-EC", {
    style: "currency",
    currency: "USD",
  }).format(Number(value) || 0);
}

function excelDate(value) {
  if (value instanceof Date) {
    return value.toLocaleDateString("es-EC");
  }

  if (typeof value === "number" && value > 20000 && value < 80000) {
    const d = XLSX.SSF.parse_date_code(value);
    if (d) {
      return `${String(d.d).padStart(2, "0")}/${String(d.m).padStart(2, "0")}/${d.y}`;
    }
  }

  return value ? String(value).trim() : "";
}

function showMessage(message, type = "info") {
  const el = $("message");
  el.textContent = message;

  const classes = {
    error: "bg-red-50 text-red-700",
    success: "bg-green-50 text-green-700",
    info: "bg-blue-50 text-blue-700",
  };

  el.className = "mt-4 rounded-lg p-3 text-sm " + classes[type];
  el.classList.remove("hidden");
}

/*
 * LECTURA DE EXCEL
 */
function readWorkbook(file, target) {
  const reader = new FileReader();

  reader.onload = (event) => {
    try {
      const workbook = XLSX.read(event.target.result, {
        type: "array",
        cellDates: true,
      });

      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, {
        defval: "",
        raw: true,
      });

      if (!rows.length) {
        throw new Error("La primera hoja no contiene filas.");
      }

      if (target === "form") {
        formRows = rows.map((row, index) => ({
          ...row,
          __row: index + 2,
          __date: excelDate(get(row, "fecha")),
          __name: String(get(row, "propietario") || "").trim(),
          __amount: num(get(row, "valor")),
          __receipt: String(get(row, "comprobante") || "").trim(),
          __type: String(get(row, "tipo") || "").trim(),
          __year: String(get(row, "anio") || "").trim(),
          __month: String(get(row, "mes") || "").trim(),
          __block: String(get(row, "manzana") || "").trim(),
          __villa: String(get(row, "villa") || "").trim(),
        }));

        $("formStatus")?.remove();
        $("formFileName").textContent = `${file.name} · ${rows.length} filas`;
      } else {
        bankRows = rows.map((row, index) => ({
          ...row,
          __row: index + 2,
          __date: excelDate(get(row, "fechaReal") || get(row, "fechaContable")),
          __type: String(get(row, "tipoBanco") || "").trim(),
          __nut: String(get(row, "nut") || "").trim(),
          __amount: num(get(row, "valor")),
          __concept: String(get(row, "concepto") || "").trim(),
          __description: String(get(row, "descripcion") || "").trim(),
          __reference: String(get(row, "referencia") || "").trim(),
          __option: String(get(row, "opcion") || "").trim(),
          __comments: String(get(row, "comentarios") || "").trim(),
        }));

        $("bankFileName").textContent = `${file.name} · ${rows.length} filas`;
      }

      $("runBtn").disabled = !(formRows.length && bankRows.length);

      showMessage(
        `${file.name}: ${rows.length} filas leídas correctamente.`,
        "success",
      );
    } catch (error) {
      showMessage("No se pudo leer el archivo: " + error.message, "error");
    }
  };

  reader.onerror = () => showMessage("No se pudo abrir el archivo.", "error");
  reader.readAsArrayBuffer(file);
}

function wireFile(inputId, target, dropId) {
  $(inputId).addEventListener("change", (event) => {
    if (event.target.files[0]) readWorkbook(event.target.files[0], target);
  });

  const zone = $(dropId);

  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
    zone.classList.add("drag");
  });

  zone.addEventListener("dragleave", () => zone.classList.remove("drag"));

  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.classList.remove("drag");

    const file = event.dataTransfer.files[0];
    if (file) readWorkbook(file, target);
  });
}

wireFile("formFile", "form", "formDrop");
wireFile("bankFile", "bank", "bankDrop");

/*
 * CLASIFICACIÓN DE MOVIMIENTOS BANCARIOS
 */
function isIncome(bank) {
  const text = norm(
    [bank.__type, bank.__description, bank.__option, bank.__comments].join(" "),
  );

  // Primero se descartan los débitos.
  if (
    /\b(N D|DEBITO|DEBITOS|GASTO|COMISION|TRANSFERENCIA ENVIADA|RETIRO)\b/.test(
      text,
    )
  ) {
    return false;
  }

  if (
    /\b(N C|CREDITO|CREDITOS|INGRESO|DEPOSITO|TRANSFERENCIA RECIBIDA|INTERMATICO|BANRED|SPI2)\b/.test(
      text,
    )
  ) {
    return true;
  }

  return (
    /^N\/?C$/i.test(bank.__type) ||
    /^DEP$/i.test(bank.__type) ||
    norm(bank.__option) === "INGRESOS" ||
    norm(bank.__option) === "TOTALIDAD"
  );
}

function isSpecial(bank) {
  const text = norm(
    [bank.__option, bank.__comments, bank.__description, bank.__concept].join(
      " ",
    ),
  );

  return (
    norm(bank.__option) === "TOTALIDAD" ||
    /DIRECTIVA ANTERIOR|TRANSFERENCIA DE LA DIRECTIVA|DEVOLUCION|PRESTAMO/.test(
      text,
    )
  );
}

function amountClose(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.011;
}

function periodText(form) {
  return [form.__month, form.__year].filter(Boolean).join(" ");
}

function bankText(bank) {
  return norm(
    [
      bank.__reference,
      bank.__concept,
      bank.__description,
      bank.__comments,
    ].join(" "),
  );
}

/*
 * EXTRACCIÓN DE MANZANA Y VILLA
 * Ejemplos: "Mz7591 V3", "Mz 93 Villa 12".
 */
function locationTokens(text) {
  const value = norm(text);
  let block = "";
  let villa = "";

  let match = value.match(
    /\b(?:MANZANA|MANZ|MZ)\s*([A-Z0-9-]+)\s*(?:VILLA|VIV|CASA|V)\s*([A-Z0-9-]+)\b/,
  );

  if (match) {
    block = match[1];
    villa = match[2];
  } else {
    match = value.match(
      /\b(?:VILLA|VIV|CASA)\s*([A-Z0-9-]+)\s*(?:MANZANA|MANZ|MZ)\s*([A-Z0-9-]+)\b/,
    );

    if (match) {
      villa = match[1];
      block = match[2];
    }
  }

  return {
    block: compact(block),
    villa: compact(villa),
  };
}

function rowLocation(form) {
  return {
    block: compact(form.__block),
    villa: compact(form.__villa),
  };
}

function refMatch(form, bank) {
  return (
    !!form.__receipt &&
    !!bank.__nut &&
    compact(form.__receipt) === compact(bank.__nut)
  );
}

function locationMatch(form, bank) {
  const formLoc = rowLocation(form);
  const bankLoc = locationTokens(
    [bank.__reference, bank.__concept, bank.__description].join(" "),
  );

  return (
    !!formLoc.block &&
    !!formLoc.villa &&
    formLoc.block === bankLoc.block &&
    formLoc.villa === bankLoc.villa
  );
}

/*
 * NORMALIZACIÓN DEL NOMBRE DEL ORDENANTE
 */
function bankName(bank) {
  let name = bank.__concept || "";

  name = name.replace(/^\s*(DE|DESDE)\s+\d+\s*[-–]?\s*/i, "");
  name = name.replace(/\s+A\s+\d{4,}.*$/i, "");

  return name || bank.__reference || "";
}

function nameScore(a, b) {
  const first = norm(a);
  const second = norm(b);

  if (!first || !second) return 0;
  if (first === second) return 1;

  if (first.includes(second) || second.includes(first)) {
    return Math.min(
      0.96,
      Math.min(first.length, second.length) /
        Math.max(first.length, second.length) +
        0.12,
    );
  }

  const A = new Set(first.split(" "));
  const B = new Set(second.split(" "));

  const common = [...A].filter((word) => word.length > 2 && B.has(word)).length;
  return common / Math.max(A.size, B.size, 1);
}

/*
 * COMPROBACIÓN DEL PERÍODO
 */
function periodMatch(form, bank) {
  const period = norm(periodText(form));
  if (!period) return false;

  const text = norm(bankText(bank));

  const months = {
    ENERO: ["ENERO", "ENE"],
    FEBRERO: ["FEBRERO", "FEB"],
    MARZO: ["MARZO", "MAR"],
    ABRIL: ["ABRIL", "ABR"],
    MAYO: ["MAYO", "MAY"],
    JUNIO: ["JUNIO", "JUN"],
    JULIO: ["JULIO", "JUL"],
    AGOSTO: ["AGOSTO", "AGO"],
    SEPTIEMBRE: ["SEPTIEMBRE", "SETIEMBRE", "SEPT", "SEP"],
    OCTUBRE: ["OCTUBRE", "OCT"],
    NOVIEMBRE: ["NOVIEMBRE", "NOV"],
    DICIEMBRE: ["DICIEMBRE", "DIC"],
  };

  let monthFound = false;

  for (const [month, variants] of Object.entries(months)) {
    if (period.includes(month) || variants.some((v) => period.includes(v))) {
      monthFound = variants.some((v) => text.includes(v));
      break;
    }
  }

  const year = (period.match(/20\d{2}/) || [])[0];

  return monthFound && (!year || text.includes(year));
}

/*
 * PUNTUACIÓN PARA COINCIDENCIAS SIN COMPROBANTE.
 */
function candidateScore(form, bank) {
  if (!isIncome(bank) || isSpecial(bank)) {
    return { score: -999 };
  }

  const sameReference = refMatch(form, bank);
  const sameLocation = locationMatch(form, bank);
  const name = nameScore(form.__name, bankName(bank));
  const amount = amountClose(form.__amount, bank.__amount);
  const period = periodMatch(form, bank);

  let score = 0;

  if (sameReference) score += 100;
  if (sameLocation) score += 45;
  if (name >= 0.75) score += 30;
  else if (name >= 0.45) score += 15;

  if (amount) score += 20;
  else score -= 10;

  if (period) score += 18;
  if (!form.__name && sameLocation) score += 10;

  return { score, sameReference, sameLocation, name, amount, period };
}

/*
 * ALGORITMO PRINCIPAL
 */
function reconcile() {
  if (!formRows.length || !bankRows.length) return;

  const strict = $("strictAmount").checked;
  const useLocation = $("allowLocation").checked;

  const forms = formRows.map((form) => ({
    ...form,
    _status: "Sin coincidencia",
    _method: "",
    _note: "No se encontró un movimiento bancario compatible.",
    _bankIds: [],
    _bankAmount: 0,
  }));

  const banks = bankRows.map((bank, index) => ({
    ...bank,
    _idx: index,
    _income: isIncome(bank),
    _allocated: [],
    _status: isIncome(bank) ? "Sin coincidencia" : "Ignorado",
  }));

  /*
   * PASO 1:
   * Agrupar filas del formulario por comprobante.
   * Una transferencia puede cubrir varias obligaciones.
   */
  const groups = new Map();

  forms.forEach((form, index) => {
    if (!form.__receipt) return;

    const key = compact(form.__receipt);

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(index);
  });

  for (const [receipt, indices] of groups) {
    const candidates = banks.filter(
      (bank) =>
        bank._income &&
        !isSpecial(bank) &&
        compact(bank.__nut) === receipt &&
        bank._allocated.length === 0,
    );

    if (!candidates.length) continue;

    const total = indices.reduce(
      (sum, index) => sum + forms[index].__amount,
      0,
    );

    candidates.sort(
      (a, b) => Math.abs(a.__amount - total) - Math.abs(b.__amount - total),
    );

    const bank = candidates[0];
    const totalMatches = amountClose(total, bank.__amount);

    if (totalMatches) {
      indices.forEach((index) => {
        forms[index]._status = "Conciliado";
        forms[index]._method = "Comprobante / NUT";
        forms[index]._note =
          indices.length > 1
            ? "Comprobante compartido; suma de obligaciones coincide con el banco."
            : "Comprobante e importe coinciden.";
        forms[index]._bankIds = [bank._idx];
        forms[index]._bankAmount = bank.__amount;
      });

      bank._allocated = indices.slice();
      bank._status = "Conciliado";
      continue;
    }

    /*
     * Si una sola obligación coincide por importe, se puede
     * conciliar esa obligación; el resto queda para revisión.
     */
    const exactRows = indices.filter((index) =>
      amountClose(forms[index].__amount, bank.__amount),
    );

    if (indices.length === 1 && exactRows.length === 1) {
      const index = indices[0];

      forms[index]._status = "Conciliado";
      forms[index]._method = "Comprobante / NUT";
      forms[index]._note = "Comprobante e importe coinciden.";
      forms[index]._bankIds = [bank._idx];
      forms[index]._bankAmount = bank.__amount;

      bank._allocated = [index];
      bank._status = "Conciliado";
      continue;
    }

    indices.forEach((index) => {
      forms[index]._status = "Revisar";
      forms[index]._method = "Comprobante / NUT";
      forms[index]._note =
        `El comprobante coincide, pero el importe no cuadra. Formulario: ${money(total)}; banco: ${money(bank.__amount)}.`;
      forms[index]._bankIds = [bank._idx];
      forms[index]._bankAmount = bank.__amount;
    });

    bank._allocated = indices.slice();
    bank._status = "Revisar";
  }

  /*
   * PASO 2:
   * Para lo restante, comparar ubicación, nombre e importe.
   */
  forms.forEach((form, index) => {
    if (form._status === "Conciliado" || form._bankIds.length) return;

    const candidates = banks
      .filter(
        (bank) =>
          bank._income && !isSpecial(bank) && bank._allocated.length === 0,
      )
      .map((bank) => ({
        bank,
        comparison: candidateScore(form, bank),
      }))
      .filter((item) => item.comparison.score >= (useLocation ? 45 : 50))
      .sort((a, b) => b.comparison.score - a.comparison.score);

    if (!candidates.length) return;

    const best = candidates[0];
    const second = candidates[1];
    const comparison = best.comparison;

    if (strict && !comparison.amount) {
      form._status = "Revisar";
      form._method = comparison.sameLocation ? "Manzana / villa" : "Nombre";
      form._note =
        "Existe una posible coincidencia, pero el importe no cuadra.";
      form._bankIds = [best.bank._idx];
      form._bankAmount = best.bank.__amount;
      best.bank._status = "Revisar";
      return;
    }

    if (second && best.comparison.score - second.comparison.score < 12) {
      form._status = "Revisar";
      form._method = "Coincidencia ambigua";
      form._note =
        "Hay varios movimientos posibles. Se necesita revisión manual.";
      form._bankIds = [best.bank._idx, second.bank._idx];
      form._bankAmount = best.bank.__amount;
      best.bank._status = "Revisar";
      return;
    }

    if (comparison.sameLocation && (!form.__name || comparison.name < 0.45)) {
      form._status = comparison.amount ? "Conciliado" : "Revisar";
      form._method = "Manzana / villa";
      form._note = comparison.amount
        ? "Ubicación e importe coinciden; el propietario no está registrado o no se confirmó."
        : "La ubicación coincide, pero el importe no cuadra.";
    } else if (comparison.name >= 0.75) {
      form._status = comparison.amount ? "Conciliado" : "Revisar";
      form._method = "Nombre";
      form._note = comparison.amount
        ? "Nombre e importe coinciden."
        : "El nombre coincide, pero el importe no cuadra.";
    } else {
      form._status = "Revisar";
      form._method = "Coincidencia probable";
      form._note = "Validar nombre, ubicación e importe.";
    }

    form._bankIds = [best.bank._idx];
    form._bankAmount = best.bank.__amount;

    if (form._status === "Conciliado") {
      best.bank._allocated.push(index);
      best.bank._status = "Conciliado";
    } else {
      best.bank._status = "Revisar";
    }
  });

  /*
   * PASO 3:
   * Añadir ingresos bancarios no asignados y movimientos ignorados.
   */
  const bankOnly = banks
    .filter(
      (bank) =>
        bank._income && !isSpecial(bank) && bank._allocated.length === 0,
    )
    .map((bank) => ({
      __isBankOnly: true,
      __row: bank.__row,
      __name: bankName(bank),
      __block: "",
      __villa: "",
      __month: "",
      __year: "",
      __type: bank.__description || bank.__type,
      __amount: 0,
      __date: "",
      __receipt: "",
      _status: "Sin coincidencia",
      _method: "Movimiento bancario",
      _note: "Ingreso bancario sin fila de formulario asignada.",
      _bankIds: [bank._idx],
      _bankAmount: bank.__amount,
    }));

  const ignored = banks
    .filter((bank) => !bank._income || isSpecial(bank))
    .map((bank) => ({
      __isBankOnly: true,
      __row: bank.__row,
      __name: bankName(bank) || bank.__description,
      __block: "",
      __villa: "",
      __month: "",
      __year: "",
      __type: bank.__description || bank.__type,
      __amount: 0,
      __date: "",
      __receipt: "",
      _status: "Ignorado",
      _method: isSpecial(bank) ? "Movimiento especial" : "No es ingreso",
      _note: isSpecial(bank)
        ? "Movimiento especial excluido de la conciliación automática."
        : "Débito, gasto o movimiento que no se trata como ingreso.",
      _bankIds: [bank._idx],
      _bankAmount: bank.__amount,
    }));

  results = [...forms, ...bankOnly, ...ignored];

  updateStats();
  renderResults();
  $("results").classList.remove("hidden");

  showMessage(
    `Conciliación terminada. ${forms.filter((row) => row._status === "Conciliado").length} filas del formulario conciliadas. Revisa los casos dudosos.`,
    "success",
  );
}

/*
 * TABLA Y FILTROS
 */
function statusPill(status) {
  const classes = {
    Conciliado: "ok",
    Revisar: "review",
    "Sin coincidencia": "missing",
    Ignorado: "ignored",
  };

  return `<span class="pill ${classes[status] || "ignored"}">${status}</span>`;
}

function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
}

function updateStats() {
  const core = results.filter((row) => !row.__isBankOnly);

  $("statForm").textContent = core.length;
  $("statBank").textContent = bankRows.length;
  $("statMatched").textContent = core.filter(
    (row) => row._status === "Conciliado",
  ).length;
  $("statReview").textContent = core.filter(
    (row) => row._status === "Revisar",
  ).length;
  $("statMissing").textContent = core.filter(
    (row) => row._status === "Sin coincidencia",
  ).length;
}

function renderResults() {
  const query = norm($("searchBox").value);

  const visible = results.filter((row) => {
    const matchesFilter =
      activeFilter === "Todos" || row._status === activeFilter;

    const bankNuts = (row._bankIds || [])
      .map((index) => bankRows[index]?.__nut || "")
      .join(" ");

    const text = norm(
      [
        row.__name,
        row.__block,
        row.__villa,
        row.__receipt,
        row.__month,
        row.__year,
        row._method,
        row._note,
        bankNuts,
      ].join(" "),
    );

    return matchesFilter && (!query || text.includes(query));
  });

  $("shownCount").textContent =
    `Mostrando ${visible.length} de ${results.length} filas`;

  $("resultBody").innerHTML =
    visible
      .map((row) => {
        const bank = (row._bankIds || [])
          .map((index) => bankRows[index])
          .filter(Boolean);

        const bankDate =
          bank
            .map((item) => item.__date)
            .filter(Boolean)
            .join(", ") || "—";
        const nuts =
          bank
            .map((item) => item.__nut)
            .filter(Boolean)
            .join(", ") || "—";

        const formInfo = row.__isBankOnly
          ? `Movimiento #${row.__row}`
          : `Fila #${row.__row} · ${esc(row.__receipt || "Sin comprobante")}`;

        const owner = row.__name || "(Propietario no registrado)";

        const location =
          row.__block || row.__villa
            ? `Mz. ${esc(row.__block || "—")} · Villa ${esc(row.__villa || "—")}`
            : "—";

        return `
<tr class="hover:bg-slate-50 align-top">
<td class="px-4 py-3">${statusPill(row._status)}</td>
<td class="px-4 py-3">
    <div class="font-semibold">${esc(owner)}</div>
    <div class="text-xs text-slate-500 mt-1">${location}</div>
</td>
<td class="px-4 py-3">
    <div>${esc(periodText(row) || "—")}</div>
    <div class="text-xs text-slate-500 mt-1">${esc(row.__type || "—")}</div>
</td>
<td class="px-4 py-3">
    <div class="font-medium">${row.__isBankOnly ? "—" : money(row.__amount)}</div>
    <div class="text-xs text-slate-500 mt-1">${formInfo}</div>
</td>
<td class="px-4 py-3">${esc(bankDate)}</td>
<td class="px-4 py-3 font-mono text-xs">${esc(nuts)}</td>
<td class="px-4 py-3 font-semibold">${money(row._bankAmount)}</td>
<td class="px-4 py-3 max-w-sm">
    <div class="font-medium">${esc(row._method || "—")}</div>
    <div class="text-xs text-slate-500 mt-1 whitespace-normal">${esc(row._note || "")}</div>
</td>
</tr>`;
      })
      .join("") ||
    `
<tr><td colspan="8" class="px-4 py-12 text-center text-slate-500">
No hay resultados para este filtro.
</td></tr>`;
}

/*
 * EXPORTAR RESULTADOS
 */
function exportResults() {
  if (!results.length) return;

  const output = results.map((row) => {
    const bank = (row._bankIds || [])
      .map((index) => bankRows[index])
      .filter(Boolean);

    return {
      Estado: row._status,
      Propietario: row.__name || "",
      Manzana: row.__block || "",
      Villa: row.__villa || "",
      Año: row.__year || "",
      Mes: row.__month || "",
      Tipo: row.__type || "",
      "Valor formulario": row.__isBankOnly ? "" : row.__amount,
      Comprobante: row.__receipt || "",
      "Fila origen": row.__row,
      "Fecha banco": bank.map((item) => item.__date).join(" | "),
      NUT: bank.map((item) => item.__nut).join(" | "),
      "Valor banco": row._bankAmount || 0,
      "Concepto banco": bank.map((item) => item.__concept).join(" | "),
      "Descripción banco": bank.map((item) => item.__description).join(" | "),
      Método: row._method || "",
      Observación: row._note || "",
    };
  });

  const workbook = XLSX.utils.book_new();
  const detailSheet = XLSX.utils.json_to_sheet(output);

  detailSheet["!cols"] = [
    { wch: 18 },
    { wch: 32 },
    { wch: 12 },
    { wch: 10 },
    { wch: 10 },
    { wch: 16 },
    { wch: 22 },
    { wch: 16 },
    { wch: 16 },
    { wch: 12 },
    { wch: 18 },
    { wch: 18 },
    { wch: 16 },
    { wch: 40 },
    { wch: 28 },
    { wch: 24 },
    { wch: 70 },
  ];

  XLSX.utils.book_append_sheet(workbook, detailSheet, "Conciliación");

  const core = results.filter((row) => !row.__isBankOnly);

  const summary = [
    { Indicador: "Filas del formulario", Valor: formRows.length },
    { Indicador: "Movimientos bancarios", Valor: bankRows.length },
    {
      Indicador: "Filas conciliadas",
      Valor: core.filter((row) => row._status === "Conciliado").length,
    },
    {
      Indicador: "Filas para revisar",
      Valor: core.filter((row) => row._status === "Revisar").length,
    },
    {
      Indicador: "Filas sin coincidencia",
      Valor: core.filter((row) => row._status === "Sin coincidencia").length,
    },
  ];

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(summary),
    "Resumen",
  );

  XLSX.writeFile(workbook, "resultado_conciliacion.xlsx");
}

/*
 * EVENTOS
 */
$("runBtn").addEventListener("click", reconcile);
$("searchBox").addEventListener("input", renderResults);
$("exportBtn").addEventListener("click", exportResults);

document.querySelectorAll(".filterTab").forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;

    document.querySelectorAll(".filterTab").forEach((tab) => {
      tab.classList.toggle("tab-active", tab === button);
      tab.classList.toggle("text-slate-500", tab !== button);
    });

    renderResults();
  });
});

$("resetBtn").addEventListener("click", () => {
  formRows = [];
  bankRows = [];
  results = [];
  activeFilter = "Todos";

  $("formFile").value = "";
  $("bankFile").value = "";
  $("formFileName").textContent = "Ningún archivo seleccionado";
  $("bankFileName").textContent = "Ningún archivo seleccionado";
  $("runBtn").disabled = true;
  $("results").classList.add("hidden");
  $("message").classList.add("hidden");

  document.querySelectorAll(".filterTab").forEach((tab) => {
    tab.classList.toggle("tab-active", tab.dataset.filter === "Todos");
    tab.classList.toggle("text-slate-500", tab.dataset.filter !== "Todos");
  });
});
