/** How shapes look in an earlier version of a drawing with its changes shown. */
export const ADDED_SHAPE_COLOR = "#2f9e44";
export const REMOVED_SHAPE_COLOR = "#868e96";

type Shape = {
  id: string;
  type: string;
  isDeleted?: boolean;
  strokeColor?: string;
  strokeStyle?: string;
  opacity?: number;
  locked?: boolean;
};

/**
 * The shapes of `version` to show, laid over the drawing as it is now
 * (`current`) when `showChanges` is on: shapes that come back on restore
 * are drawn in green, and the ones that go away dashed and faded, on top.
 */
export function diffDrawingShapes<T extends Shape>(
  version: readonly T[],
  current: readonly T[],
  showChanges: boolean,
): { shapes: T[]; hasChanges: boolean } {
  const live = (shapes: readonly T[]) =>
    shapes.filter((shape) => !shape.isDeleted);
  const versionShapes = live(version);
  const currentShapes = live(current);
  const versionIds = new Set(versionShapes.map((shape) => shape.id));
  const currentIds = new Set(currentShapes.map((shape) => shape.id));

  const added = versionShapes.filter((shape) => !currentIds.has(shape.id));
  const removed = currentShapes.filter((shape) => !versionIds.has(shape.id));
  const hasChanges = added.length > 0 || removed.length > 0;
  if (!showChanges || !hasChanges) return { shapes: versionShapes, hasChanges };

  const addedIds = new Set(added.map((shape) => shape.id));
  return {
    shapes: [
      ...versionShapes.map((shape) =>
        addedIds.has(shape.id)
          ? { ...shape, strokeColor: ADDED_SHAPE_COLOR }
          : shape,
      ),
      ...removed.map((shape) => ({
        ...shape,
        strokeColor: REMOVED_SHAPE_COLOR,
        strokeStyle: "dashed",
        opacity: Math.min(shape.opacity ?? 100, 60),
        locked: true,
      })),
    ],
    hasChanges,
  };
}
