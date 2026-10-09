import { observeContainer } from '../observe';
import type { GitHubAdapter, MdFile } from '../types';
import * as read from './read';

/** Read-only adapter for the classic Files page as seen without a signed-in session. */
export function createClassicAdapter(): GitHubAdapter {
  return {
    readOnlyNote: 'Sign in to comment',
    viewerAvatar: () => null,
    pageLooksSupported: read.pageLooksSupported,
    findMarkdownFiles: read.findMarkdownFiles,
    richToggle: read.richToggle,
    sourceToggle: read.sourceToggle,
    diffBody: read.diffBody,
    readDiff: read.readDiff,
    readHunks: read.readHunks,
    readThreads: read.readThreads,
    revealSourceLine(file: MdFile, line: number) {
      read.sourceToggle(file)?.click();
      read.findLineCell(file, line)?.scrollIntoView({ block: 'center' });
    },
    observe: (file, onChange) => observeContainer(file.container, onChange),
  };
}
