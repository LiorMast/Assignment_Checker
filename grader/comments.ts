export interface CommentDef {
  /** Hebrew text shown to the student (and in the xlsx comments table). */
  text: string;
  /** Points deducted; 0 = note only. With `perUnit`, points per unit (e.g. per missing box). */
  points: number;
  perUnit?: boolean;
  /** Upper limit for `perUnit` comments. */
  max?: number;
}

export interface Comment extends CommentDef {
  key: string;
  /** Number in the comments table, as used in the "מספרי הערות" column. */
  no: number;
}

/**
 * Numbers the comments in the order they are written (1, 2, 3...).
 * Once grading has started, only append new comments so existing numbers stay stable.
 */
export function defineComments<K extends string>(defs: Record<K, CommentDef>): Record<K, Comment> {
  const table = {} as Record<K, Comment>;
  (Object.keys(defs) as K[]).forEach((key, i) => {
    table[key] = { key, no: i + 1, ...defs[key] };
  });
  return table;
}

export function pointsFor(comment: Comment, times = 1): number {
  const points = comment.perUnit ? comment.points * times : comment.points;
  return comment.max === undefined ? points : Math.min(points, comment.max);
}

/** Value for the "ניקוד להפחתה" column of the comments table. */
export function pointsLabel(comment: Comment): string | number {
  if (!comment.perUnit) return comment.points;
  return `${comment.points} לכל פריט` + (comment.max === undefined ? '' : ` (עד ${comment.max})`);
}
