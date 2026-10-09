import { hostThread } from './hosted-thread';
import { openNativeForm } from './native-form';
import * as navigate from './navigate';
import { observeContainer } from './observe';
import * as read from './read';
import type { GitHubAdapter } from './types';

export function createGitHubAdapter(): GitHubAdapter {
  return {
    readOnlyNote: null,
    readHunks: read.readHunks,
    viewerAvatar: read.viewerAvatar,
    pageLooksSupported: read.pageLooksSupported,
    findMarkdownFiles: read.findMarkdownFiles,
    richToggle: read.richToggle,
    sourceToggle: read.sourceToggle,
    diffBody: read.diffBody,
    readDiff: read.readDiff,
    readThreads: read.readThreads,
    threadMarkers: read.threadMarkers,
    threadsReadable: read.threadsReadable,
    hostThread,
    viewerLogin: read.viewerLogin,
    markdownRefs: read.markdownRefs,
    loadPageData: read.loadPageData,
    forgetPageData: read.forgetPageData,
    revealSourceLine: navigate.revealSourceLine,
    openNativeForm,
    observe: (file, onChange) => observeContainer(file.container, onChange),
  };
}
