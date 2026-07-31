const fs = require("fs");
const path = require("path");
const xlsx = require("xlsx");

const srcPath = path.join(__dirname, "..", "assets", "list of districts with schools.xlsx");
const outPath = path.join(__dirname, "..", "data", "district-schools.json");

function normalizeReferenceCell(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

function findHeaderIndex(rows) {
  for (let i = 0; i < rows.length; i += 1) {
    const row = Array.isArray(rows[i]) ? rows[i].map((cell) => normalizeReferenceCell(cell).toLowerCase()) : [];
    const districtIdx = row.findIndex((cell) => cell === "district" || cell.includes("district"));
    const schoolNameIdx = row.findIndex(
      (cell) => cell === "name of school" || (cell.includes("school") && !cell.includes("id"))
    );
    const schoolIdIdx = row.findIndex((cell) => cell === "school id" || (cell.includes("school") && cell.includes("id")));
    if (districtIdx >= 0 && schoolNameIdx >= 0) {
      return { rowIndex: i, districtIdx, schoolNameIdx, schoolIdIdx };
    }
  }

  return null;
}

function parseDistrictSchoolRows(rows) {
  const header = findHeaderIndex(rows);
  const districtToSchools = new Map();

  let startIndex = 0;
  let districtIdx = 0;
  let schoolNameIdx = 1;
  let schoolIdIdx = -1;

  if (header) {
    startIndex = header.rowIndex + 1;
    districtIdx = header.districtIdx;
    schoolNameIdx = header.schoolNameIdx;
    schoolIdIdx = header.schoolIdIdx;
  }

  for (let i = startIndex; i < rows.length; i += 1) {
    const row = Array.isArray(rows[i]) ? rows[i] : [];
    const district = normalizeReferenceCell(row[districtIdx]);
    const schoolName = normalizeReferenceCell(row[schoolNameIdx]);
    const schoolId = schoolIdIdx >= 0 ? normalizeReferenceCell(row[schoolIdIdx]) : "";

    if (!district || !schoolName) {
      continue;
    }

    if (!districtToSchools.has(district)) {
      districtToSchools.set(district, new Map());
    }

    const schoolMap = districtToSchools.get(district);
    if (!schoolMap.has(schoolName)) {
      schoolMap.set(schoolName, {
        id: schoolId,
        name: schoolName
      });
    }
  }

  const districts = Array.from(districtToSchools.keys()).sort((a, b) => a.localeCompare(b));
  const schoolsByDistrict = {};

  districts.forEach((district) => {
    schoolsByDistrict[district] = Array.from(districtToSchools.get(district).values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  });

  return { districts, schoolsByDistrict };
}

if (!fs.existsSync(srcPath)) {
  throw new Error("Missing source file: " + srcPath);
}

const workbook = xlsx.readFile(srcPath);
const firstSheetName = workbook.SheetNames[0];
if (!firstSheetName) {
  throw new Error("No worksheet found in district-school Excel file.");
}

const worksheet = workbook.Sheets[firstSheetName];
const rows = xlsx.utils.sheet_to_json(worksheet, {
  header: 1,
  raw: false,
  defval: ""
});

const parsed = parseDistrictSchoolRows(rows);
const payload = {
  sourceFile: "assets/list of districts with schools.xlsx",
  generatedAt: new Date().toISOString(),
  districts: parsed.districts,
  schoolsByDistrict: parsed.schoolsByDistrict
};

fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log("Generated:", outPath);
console.log("Districts:", payload.districts.length);
console.log(
  "Schools:",
  Object.values(payload.schoolsByDistrict).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0)
);
