"use strict";

let formRows = [];
let bankRows = [];
let results = [];
let activeFilter = "Todos";

const STORAGE_KEY = "conciliacion_pagos_v2";

let manualAssignments = {};
let manualCategories = {};

try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  manualAssignments = saved.assignments || {};
  manualCategories = saved.categories || {};
} catch (error) {
  manualAssignments = {};
  manualCategories = {};
}

function saveLocalState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        assignments: manualAssignments,
        categories: manualCategories,
      }),
    );
  } catch (error) {
    showMessage(
      "No se pudieron guardar los cambios en este navegador. Revisa el espacio disponible.",
      "error",
    );
  }
}

// Claves basadas en los datos, no en el índice de la fila.
function bankKey(bank) {
  return [
    bank.__row,
    bank.__date,
    bank.__nut,
    bank.__amount,
    bank.__concept,
    bank.__reference,
  ].join("|");
}

function formKey(form) {
  return [
    form.__row,
    form.__receipt,
    form.__name,
    form.__amount,
    form.__block,
    form.__villa,
    form.__month,
    form.__year,
  ].join("|");
}

function defaultCategory(bank) {
  if (isSpecial(bank)) return "Especial";
  if (isIncome(bank)) return "Ingreso";
  return "Por clasificar";
}

function getCategory(bank) {
  return manualCategories[bankKey(bank)] || defaultCategory(bank);
}

function getAutomaticForms(bankIndex) {
  // No utilizar coincidencias ambiguas como asignaciones definitivas.
  const isUnallocated = results.some(
    (row) =>
      row.__isBankOnly &&
      row._status === "Sin coincidencia" &&
      (row._bankIds || []).includes(bankIndex),
  );

  if (isUnallocated) return [];

  return results.filter(
    (row) =>
      !row.__isBankOnly &&
      ["Conciliado", "Revisar"].includes(row._status) &&
      (row._bankIds || []).length === 1 &&
      row._bankIds[0] === bankIndex,
  );
}

function getAssignedForms(bankIndex) {
  const key = bankKey(bankRows[bankIndex]);

  // Una asignación manual, incluso "__UNASSIGNED__", prevalece
  // sobre el resultado automático.
  if (Object.prototype.hasOwnProperty.call(manualAssignments, key)) {
    const selected = manualAssignments[key];

    if (selected === "__UNASSIGNED__") return [];

    const form = formRows.find((row) => formKey(row) === selected);
    return form ? [form] : [];
  }

  return getAutomaticForms(bankIndex);
}

function isFormAssignedElsewhere(selectedFormKey, currentBankKey) {
  if (!selectedFormKey) return false;

  // Evita asignar manualmente el mismo pago a dos movimientos.
  for (const [key, value] of Object.entries(manualAssignments)) {
    if (key !== currentBankKey && value === selectedFormKey) return true;
  }

  for (let i = 0; i < bankRows.length; i++) {
    if (bankKey(bankRows[i]) === currentBankKey) continue;

    const manuallyOverridden = Object.prototype.hasOwnProperty.call(
      manualAssignments,
      bankKey(bankRows[i]),
    );

    if (manuallyOverridden) continue;

    if (getAutomaticForms(i).some((row) => formKey(row) === selectedFormKey)) {
      return true;
    }
  }

  return false;
}

function amountForForms(forms) {
  return forms.reduce((sum, form) => sum + Number(form.__amount || 0), 0);
}

function movementStatus(bank, assignedForms) {
  const category = getCategory(bank);

  if (category === "Gasto") return "Gasto";
  if (category === "Especial") return "Especial";
  if (category === "Por clasificar") return "Por clasificar";

  if (!assignedForms.length) return "Pendiente";

  return amountClose(bank.__amount, amountForForms(assignedForms))
    ? "Conciliado"
    : "Pendiente";
}

function statusHtml(status) {
  const styles = {
    Conciliado: "status-matched",
    Pendiente: "status-pending",
    Gasto: "status-expense",
    Especial: "status-special",
    "Por clasificar": "status-unclassified",
  };

  return `<span class="status-pill ${styles[status] || "status-unclassified"}">${esc(status)}</span>`;
}

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
    /\b(?:MANZANA|MANZ|MZ)\s*([A-Z0-9-]+?)\s*(?:VILLA|VIV|CASA|V)\s*([A-Z0-9-]+)\b/,
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
  let name = String(bank.__concept || "").trim();

  // Eliminar datos de cuenta y sufijos bancarios.
  name = name.replace(/^\s*(DE|DESDE)\s+\d+\s*[-–]?\s*/i, "");
  name = name.replace(/\s+A\s+\d{4,}.*$/i, "");
  name = name.replace(/\b\d{2,}[X*]{2,}\d*\b.*$/i, "");
  name = name.replace(
    /\b(?:BANCO|PICHINCHA|GUAYAQUIL|PACIFICO|PRODUBANCO|BOLIVARIANO|INTERNACIONAL|AUSTRO)\b.*$/i,
    "",
  );
  name = name.replace(/\s+/g, " ").trim();

  return name || bank.__reference || "";
}

function nameTokens(value) {
  const ignored = new Set([
    "BANCO",
    "PICHINCHA",
    "GUAYAQUIL",
    "PACIFICO",
    "PRODUBANCO",
    "BOLIVARIANO",
    "INTERNACIONAL",
    "AUSTRO",
    "COOP",
    "COOPERATIVA",
    "CTA",
    "CUENTA",
    "AHORRO",
    "AHORROS",
    "CORRIENTE",
    "TRANSFERENCIA",
  ]);

  return norm(value)
    .split(" ")
    .filter((token) => token.length > 1 && !ignored.has(token));
}

function tokenNameMatch(a, b) {
  if (a === b) return true;

  // Permite comparar una inicial con el inicio de un nombre.
  return (
    (a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b))
  );
}

function nameScore(a, b) {
  const A = nameTokens(a);
  const B = nameTokens(b);

  if (!A.length || !B.length) return 0;
  if (A.join(" ") === B.join(" ")) return 1;

  const used = new Set();
  let matched = 0;

  for (const tokenA of A) {
    let bestIndex = -1;
    let bestLength = -1;

    B.forEach((tokenB, index) => {
      if (used.has(index) || !tokenNameMatch(tokenA, tokenB)) return;

      const length = Math.min(tokenA.length, tokenB.length);

      if (length > bestLength) {
        bestLength = length;
        bestIndex = index;
      }
    });

    if (bestIndex >= 0) {
      used.add(bestIndex);
      matched++;
    }
  }

  const coverage = matched / Math.max(A.length, B.length);

  if (matched === Math.min(A.length, B.length) && coverage >= 0.75) {
    return Math.min(0.98, coverage + 0.12);
  }

  return coverage;
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
  let matchedAmount = 0;
  let pendingAmount = 0;
  let expenseAmount = 0;
  let unclassifiedAmount = 0;
  let matchedCount = 0;
  let pendingCount = 0;
  let expenseCount = 0;
  let unclassifiedCount = 0;

  bankRows.forEach((bank, index) => {
    const assigned = getAssignedForms(index);
    const status = movementStatus(bank, assigned);
    const amount = Number(bank.__amount || 0);

    if (status === "Conciliado") {
      matchedAmount += amount;
      matchedCount++;
    } else if (status === "Pendiente") {
      pendingAmount += amount;
      pendingCount++;
    } else if (status === "Gasto") {
      expenseAmount += Math.abs(amount);
      expenseCount++;
    } else if (status === "Por clasificar") {
      unclassifiedAmount += Math.abs(amount);
      unclassifiedCount++;
    }
  });

  $("sumMatched").textContent = money(matchedAmount);
  $("sumPending").textContent = money(pendingAmount);
  $("sumExpenses").textContent = money(expenseAmount);
  $("sumUnclassified").textContent = money(unclassifiedAmount);

  $("countMatched").textContent = `${matchedCount} movimientos`;
  $("countPending").textContent = `${pendingCount} movimientos`;
  $("countExpenses").textContent = `${expenseCount} movimientos`;
  $("countUnclassified").textContent = `${unclassifiedCount} movimientos`;
}

function renderResults() {
  const query = norm($("searchBox").value);
  const filter = $("statusFilter").value;

  const formOptions = formRows.map((form) => {
    const label = [
      form.__name || "Sin propietario",
      `Mz ${form.__block || "—"} / Villa ${form.__villa || "—"}`,
      periodText(form) || "Sin período",
      money(form.__amount),
      form.__receipt ? `Comp. ${form.__receipt}` : "",
    ]
      .filter(Boolean)
      .join(" · ");

    return { key: formKey(form), label, form };
  });

  const visibleRows = bankRows
    .map((bank, index) => {
      const assigned = getAssignedForms(index);
      const category = getCategory(bank);
      const status = movementStatus(bank, assigned);
      const assignedAmount = amountForForms(assigned);
      const currentKey = bankKey(bank);
      const hasManual = Object.prototype.hasOwnProperty.call(
        manualAssignments,
        currentKey,
      );

      const automatic = getAutomaticForms(index);
      const selectedValue = hasManual
        ? manualAssignments[currentKey]
        : automatic.length === 1
          ? formKey(automatic[0])
          : "";

      const bankLabel =
        bankName(bank) ||
        bank.__description ||
        bank.__type ||
        "Movimiento sin descripción";

      const searchable = norm(
        [
          bankLabel,
          bank.__date,
          bank.__nut,
          bank.__concept,
          bank.__description,
          bank.__reference,
          bank.__type,
          category,
          status,
          ...assigned.map((form) =>
            [
              form.__name,
              form.__block,
              form.__villa,
              form.__receipt,
              form.__month,
              form.__year,
            ].join(" "),
          ),
        ].join(" "),
      );

      return {
        bank,
        index,
        assigned,
        category,
        status,
        assignedAmount,
        currentKey,
        selectedValue,
        bankLabel,
        searchable,
      };
    })
    .filter((item) => {
      if (query && !item.searchable.includes(query)) return false;
      if (filter !== "Todos" && item.status !== filter) return false;
      return true;
    });

  $("shownCount").textContent =
    `${visibleRows.length} de ${bankRows.length} movimientos`;

  $("bankTableBody").innerHTML =
    visibleRows
      .map((item) => {
        const {
          bank,
          index,
          assigned,
          category,
          status,
          assignedAmount,
          currentKey,
          selectedValue,
          bankLabel,
        } = item;

        const assignedLabel = assigned.length
          ? assigned
              .map(
                (form) =>
                  `${form.__name || "Sin propietario"} · Mz ${form.__block || "—"} / Villa ${form.__villa || "—"}`,
              )
              .join("<br>")
          : "";

        const optionHtml = formOptions
          .map((option) => {
            const isUsed = isFormAssignedElsewhere(option.key, currentKey);
            const isSelected = selectedValue === option.key;

            return `<option value="${esc(option.key)}"
        ${isSelected ? "selected" : ""}
        ${isUsed && !isSelected ? "disabled" : ""}>
        ${esc(option.label)}${isUsed && !isSelected ? " (asignado)" : ""}
      </option>`;
          })
          .join("");

        const assignmentHtml = `
      ${
        assigned.length > 1
          ? `<div class="mb-2 text-xs text-slate-600">${assignedLabel}</div>`
          : assigned.length === 1
            ? `<div class="mb-2 text-xs text-slate-600">${esc(assignedLabel)}</div>`
            : `<div class="mb-2 text-xs text-amber-700">Sin registro asignado</div>`
      }
      <select class="assignment-select" data-bank-index="${index}"
        aria-label="Asignar registro del formulario">
        <option value="">Seleccionar registro...</option>
        <option value="__UNASSIGNED__"
          ${selectedValue === "__UNASSIGNED__" ? "selected" : ""}>
          Quitar asignación
        </option>
        ${optionHtml}
      </select>`;

        const categoryOptions = [
          ["Ingreso", "Ingreso / pago"],
          ["Gasto", "Gasto"],
          ["Especial", "Movimiento especial"],
          ["Por clasificar", "Por clasificar"],
        ]
          .map(
            ([value, label]) =>
              `<option value="${value}" ${category === value ? "selected" : ""}>${label}</option>`,
          )
          .join("");

        return `
      <tr>
        <td class="whitespace-nowrap">${esc(bank.__date || "—")}</td>
        <td>
          <div class="font-semibold">${esc(bankLabel)}</div>
          <div class="text-xs text-slate-500 mt-1">
            ${esc(bank.__description || bank.__type || "")}
          </div>
          <div class="text-xs text-slate-400 mt-1">
            Fila ${esc(bank.__row)}
          </div>
        </td>
        <td>
          <div class="font-mono text-xs">${esc(bank.__nut || "—")}</div>
          <div class="text-xs text-slate-500 mt-1">${esc(bank.__reference || "")}</div>
        </td>
        <td class="text-right whitespace-nowrap font-semibold">${money(bank.__amount)}</td>
        <td class="min-w-[280px]">${assignmentHtml}</td>
        <td class="text-right whitespace-nowrap">
          ${assigned.length ? money(assignedAmount) : "—"}
          ${
            assigned.length && !amountClose(bank.__amount, assignedAmount)
              ? `<div class="text-xs text-amber-700 mt-1">Diferencia: ${money(bank.__amount - assignedAmount)}</div>`
              : ""
          }
        </td>
        <td>
          <select class="category-select" data-category-index="${index}"
            aria-label="Clasificar movimiento">
            ${categoryOptions}
          </select>
        </td>
        <td>${statusHtml(status)}</td>
      </tr>`;
      })
      .join("") ||
    `
    <tr>
      <td colspan="8" class="text-center text-slate-500 py-10">
        No hay movimientos que coincidan con esta búsqueda.
      </td>
    </tr>`;

  // Los registros del formulario que no están asignados se mantienen visibles
  // para que el usuario pueda detectar pagos reportados sin respaldo bancario.
  const assignedFormKeys = new Set();

  bankRows.forEach((bank, index) => {
    getAssignedForms(index).forEach((form) =>
      assignedFormKeys.add(formKey(form)),
    );
  });

  const unmatchedForms = formRows.filter(
    (form) => !assignedFormKeys.has(formKey(form)),
  );

  $("unmatchedFormCount").textContent = `(${unmatchedForms.length})`;

  $("unmatchedFormBody").innerHTML =
    unmatchedForms
      .map(
        (form) => `
    <tr>
      <td class="font-semibold">${esc(form.__name || "Sin propietario")}</td>
      <td>Mz ${esc(form.__block || "—")} · Villa ${esc(form.__villa || "—")}</td>
      <td>
        ${esc(periodText(form) || "—")}
        <div class="text-xs text-slate-500 mt-1">${esc(form.__type || "")}</div>
      </td>
      <td class="font-mono text-xs">${esc(form.__receipt || "—")}</td>
      <td class="text-right font-semibold whitespace-nowrap">${money(form.__amount)}</td>
    </tr>
  `,
      )
      .join("") ||
    `
    <tr>
      <td colspan="5" class="text-center text-slate-500 py-6">
        Todos los registros del formulario están asignados.
      </td>
    </tr>`;

  updateStats();
}

/*
 * EXPORTAR RESULTADOS
 */

function exportResults() {
  if (!bankRows.length) return;

  const output = bankRows.map((bank, index) => {
    const assigned = getAssignedForms(index);
    const category = getCategory(bank);
    const status = movementStatus(bank, assigned);

    return {
      Estado: status,
      Categoría: category,
      Fecha: bank.__date || "",
      Movimiento: bankName(bank) || bank.__description || bank.__type || "",
      NUT: bank.__nut || "",
      Referencia: bank.__reference || "",
      "Valor banco": bank.__amount,
      "Propietario asignado": assigned.map((f) => f.__name).join(" | "),
      Manzana: assigned.map((f) => f.__block).join(" | "),
      Villa: assigned.map((f) => f.__villa).join(" | "),
      Período: assigned.map(periodText).join(" | "),
      Comprobante: assigned.map((f) => f.__receipt).join(" | "),
      "Valor formulario": assigned.length ? amountForForms(assigned) : "",
      Diferencia: assigned.length
        ? Number(bank.__amount) - amountForForms(assigned)
        : "",
      "Fila banco": bank.__row,
      "Observación bancaria": bank.__description || "",
    };
  });

  const workbook = XLSX.utils.book_new();
  const detail = XLSX.utils.json_to_sheet(output);

  detail["!cols"] = [
    { wch: 18 },
    { wch: 20 },
    { wch: 14 },
    { wch: 36 },
    { wch: 18 },
    { wch: 28 },
    { wch: 16 },
    { wch: 32 },
    { wch: 12 },
    { wch: 12 },
    { wch: 22 },
    { wch: 20 },
    { wch: 18 },
    { wch: 16 },
    { wch: 12 },
    { wch: 40 },
  ];

  XLSX.utils.book_append_sheet(workbook, detail, "Movimientos");

  const summary = [
    { Indicador: "Movimientos bancarios", Valor: bankRows.length },
    { Indicador: "Ingresos conciliados", Valor: $("sumMatched").textContent },
    { Indicador: "Ingresos pendientes", Valor: $("sumPending").textContent },
    { Indicador: "Gastos clasificados", Valor: $("sumExpenses").textContent },
    {
      Indicador: "Movimientos por clasificar",
      Valor: $("sumUnclassified").textContent,
    },
    {
      Indicador: "Pagos del formulario sin respaldo bancario",
      Valor: formRows.filter((form) => {
        return !bankRows.some((bank, index) =>
          getAssignedForms(index).some(
            (assigned) => formKey(assigned) === formKey(form),
          ),
        );
      }).length,
    },
  ];

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(summary),
    "Resumen",
  );

  XLSX.writeFile(workbook, "administracion_pagos.xlsx");
}

/*
 * EVENTOS
 */

/* EVENTOS */
$("runBtn").addEventListener("click", reconcile);
$("searchBox").addEventListener("input", renderResults);
$("statusFilter").addEventListener("change", renderResults);
$("exportBtn").addEventListener("click", exportResults);

$("bankTableBody").addEventListener("change", (event) => {
  const assignmentSelect = event.target.closest("[data-bank-index]");

  if (assignmentSelect) {
    const index = Number(assignmentSelect.dataset.bankIndex);
    const bank = bankRows[index];
    if (!bank) return;

    const key = bankKey(bank);
    const value = assignmentSelect.value || "__UNASSIGNED__";

    if (value !== "__UNASSIGNED__" && isFormAssignedElsewhere(value, key)) {
      showMessage(
        "Este registro ya está asignado a otro movimiento bancario. Quita la asignación anterior primero.",
        "error",
      );
      renderResults();
      return;
    }

    manualAssignments[key] = value;
    saveLocalState();
    renderResults();

    showMessage("Asignación guardada en este navegador.", "success");
    return;
  }

  const categorySelect = event.target.closest("[data-category-index]");

  if (categorySelect) {
    const index = Number(categorySelect.dataset.categoryIndex);
    const bank = bankRows[index];
    if (!bank) return;

    manualCategories[bankKey(bank)] = categorySelect.value;
    saveLocalState();
    renderResults();

    showMessage("Categoría guardada en este navegador.", "success");
  }
});

$("resetBtn").addEventListener("click", () => {
  formRows = [];
  bankRows = [];
  results = [];

  $("formFile").value = "";
  $("bankFile").value = "";
  $("formFileName").textContent = "Seleccionar Excel o CSV";
  $("bankFileName").textContent = "Seleccionar Excel o CSV";
  $("runBtn").disabled = true;
  $("results").classList.add("hidden");
  $("message").classList.add("hidden");
  $("searchBox").value = "";
  $("statusFilter").value = "Todos";
});

// Refrescar el resumen y la tabla cuando el navegador restaura la página.
window.addEventListener("pageshow", () => {
  if (bankRows.length && results.length) renderResults();
});
