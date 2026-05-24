import {
  PDFPage,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  concatTransformationMatrix,
} from "pdf-lib";
import {
  PRAKTIKA_TOOTH_SVGS,
  PraktikaSvgView,
  PraktikaToothShape,
} from "@/lib/praktika/tooth-svgs";
import {
  PRAKTIKA_ROOT_SVGS,
  PraktikaRootType,
} from "@/lib/praktika/root-svgs";

type Arch = "maxilla" | "mandible";
type Side = "B" | "L";

const TOOTH_FILL = rgb(0.949, 0.949, 0.914);
const TOOTH_BORDER = rgb(0.737, 0.796, 0.827);
const ROOT_FILL = rgb(0.976, 0.937, 0.863);
const ROOT_BORDER = rgb(0.867, 0.761, 0.62);

const DEFAULT_TOOTH_SCALE = 0.55;

function isMolar(toothNumber: number) {
  return [16, 17, 18, 26, 27, 28, 36, 37, 38, 46, 47, 48].includes(
    toothNumber
  );
}

function isCanine(toothNumber: number) {
  return [13, 23, 33, 43].includes(toothNumber);
}

function toothShapeForNumber(toothNumber: number): PraktikaToothShape {
  if (isMolar(toothNumber)) return "molar";
  if ([14, 24, 34, 44].includes(toothNumber)) return "firstPremolar";
  if ([15, 25, 35, 45].includes(toothNumber)) return "secondPremolar";
  if (isCanine(toothNumber)) return "canine";
  return "incisor";
}

function rootTypeForToothNumber(toothNumber: number): PraktikaRootType {
  switch (toothNumber) {
    case 14:
    case 24:
    case 36:
    case 37:
    case 46:
    case 47:
      return "twoRoots";

    case 16:
    case 17:
    case 18:
    case 26:
    case 27:
    case 28:
    case 38:
    case 48:
      return "threeRoots";

    default:
      return "oneRoot";
  }
}

function getSvgView(arch: Arch, side: Side): PraktikaSvgView {
  if (arch === "maxilla") {
    return side === "B" ? "upper" : "lower";
  }

  return "upper";
}

function scaleSvgPathData(path: string, scale: number) {
  return path.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, (match) => {
    const value = Number(match);
    if (!Number.isFinite(value)) return match;
    return Number((value * scale).toFixed(4)).toString();
  });
}

function drawSvgPaths(params: {
  page: PDFPage;
  paths: string[];
  x: number;
  y: number;
  scale: number;
  fill: ReturnType<typeof rgb>;
  border: ReturnType<typeof rgb>;
  borderWidth: number;
}) {
  const { page, paths, x, y, scale, fill, border, borderWidth } = params;

  paths.forEach((path) => {
    page.drawSvgPath(scaleSvgPathData(path, scale), {
      x,
      y,
      scale: 1,
      color: fill,
      borderColor: border,
      borderWidth: Math.max(0.08, borderWidth * scale),
    });
  });
}

function toothSpecificXOffset(toothNumber: number) {
  if (isMolar(toothNumber)) return -5.5;
  if (isCanine(toothNumber)) return -6.5;
  return -5.5;
}

function drawMaxillaryTooth(params: {
  page: PDFPage;
  toothNumber: number;
  x: number;
  y: number;
  side: Side;
  scale: number;
}) {
  const { page, toothNumber, x, y, side, scale } = params;

  const view = getSvgView("maxilla", side);
  const shape = toothShapeForNumber(toothNumber);
  const rootType = rootTypeForToothNumber(toothNumber);

  const rootAnchorY = side === "B" ? y + 18 : y - 8;
  const crownAnchorY = side === "B" ? y + 22 : y - 4;

  drawSvgPaths({
    page,
    paths: PRAKTIKA_ROOT_SVGS[rootType][view],
    x,
    y: rootAnchorY,
    scale,
    fill: ROOT_FILL,
    border: ROOT_BORDER,
    borderWidth: 0.18,
  });

  drawSvgPaths({
    page,
    paths: PRAKTIKA_TOOTH_SVGS[shape][view],
    x,
    y: crownAnchorY,
    scale,
    fill: TOOTH_FILL,
    border: TOOTH_BORDER,
    borderWidth: 0.2,
  });
}

function drawMandibularTooth(params: {
  page: PDFPage;
  toothNumber: number;
  x: number;
  y: number;
  scale: number;
}) {
  const { page, toothNumber, x, y, scale } = params;

  const view: PraktikaSvgView = "upper";
  const shape = toothShapeForNumber(toothNumber);
  const rootType = rootTypeForToothNumber(toothNumber);

  const MIRROR_OFFSET = 7;
  const mirrorY = y + MIRROR_OFFSET;

  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(1, 0, 0, -1, 0, mirrorY * 2)
  );

  drawSvgPaths({
    page,
    paths: PRAKTIKA_ROOT_SVGS[rootType][view],
    x,
    y: y + 4,
    scale,
    fill: ROOT_FILL,
    border: ROOT_BORDER,
    borderWidth: 0.18,
  });

  drawSvgPaths({
    page,
    paths: PRAKTIKA_TOOTH_SVGS[shape][view],
    x,
    y: y + 8,
    scale,
    fill: TOOTH_FILL,
    border: TOOTH_BORDER,
    borderWidth: 0.2,
  });

  page.pushOperators(popGraphicsState());
}

export function drawPraktikaToothBlock(params: {
  page: PDFPage;
  toothNumber: number;
  x: number;
  y: number;
  arch: Arch;
  side?: Side;
  scale?: number;
}) {
  const {
    page,
    toothNumber,
    x,
    y,
    arch,
    side = "B",
    scale = DEFAULT_TOOTH_SCALE,
  } = params;

  const drawX = x + toothSpecificXOffset(toothNumber);

  if (arch === "mandible") {
    drawMandibularTooth({
      page,
      toothNumber,
      x: drawX,
      y,
      scale,
    });
    return;
  }

  drawMaxillaryTooth({
    page,
    toothNumber,
    x: drawX,
    y,
    side,
    scale,
  });
}