import { findRightLineRow, sourceToggle } from './read';
import type { MdFile } from './types';

/** GitHub's source diff, scrolled to a line of the new file. */
export function revealSourceLine(file: MdFile, line: number): void {
  sourceToggle(file)?.click();
  findRightLineRow(file, line)?.scrollIntoView({ block: 'center' });
}
