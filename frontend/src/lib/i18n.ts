import type { LanguagePreference, ResolvedLanguage } from './settings'

type Widen<T> = T extends string
  ? string
  : T extends (...args: infer Args) => infer Result
    ? (...args: Args) => Result
    : T extends object
      ? { -readonly [Key in keyof T]: Widen<T[Key]> }
      : T

const englishMessages = {
  common: {
    cancel: 'Cancel',
    close: 'Close',
    emptyFolder: 'Empty folder',
    folder: 'Folder',
    folderName: 'Folder name',
    notes: 'Notes',
    root: 'Root',
    rootNotes: 'Root notes',
    trash: 'Trash',
    trashEmpty: 'Trash is empty',
    untitled: 'Untitled',
  },
  sidebar: {
    backToNotes: 'Back to notes',
    create: 'Create',
    editor: 'Editor',
    hideSidebar: 'Hide sidebar',
    moveFolderToTrash: 'Move folder to Trash',
    moveNote: 'Move note',
    moveNoteToTrash: 'Move note to Trash',
    moveToTrash: 'Move to Trash',
    newFolder: 'New folder',
    newNote: 'New note',
    noteList: 'Note list',
    opening: 'Opening…',
    settings: 'Settings',
    showSidebar: 'Show sidebar',
    trashActions: 'Trash actions',
    trashNotes: 'Trash notes',
    trashViewer: 'Trash viewer',
    emptyTrash: 'Empty Trash…',
    folderLabel: (name: string) => `${name} folder`,
  },
  document: {
    deleteFolderPermanently: 'Delete folder permanently…',
    deletePermanently: 'Delete permanently…',
    deletedFolderEmpty: 'This deleted folder is empty.',
    exportMarkdown: 'Export as Markdown…',
    folderRecoveryReadOnly: 'Folder recovery unit · read-only',
    more: 'More',
    moreActions: 'More actions',
    noteTitle: 'Note title',
    opening: 'Opening note…',
    readOnlyInTrash: 'Read-only in Trash',
    restore: 'Restore',
    restoreFolder: 'Restore folder',
    trashEmptyBody: 'Deleted notes and folders stay here until you restore or permanently delete them.',
  },
  search: {
    noMatches: 'No matching notes',
    placeholder: 'Search notes',
    recentlyModified: 'Recently modified',
    results: 'Results',
    title: 'Search notes',
    unavailable: 'Search is unavailable right now.',
  },
  settingsPage: {
    appearance: 'Appearance',
    appearanceTheme: 'Appearance theme',
    close: 'Close settings',
    dark: 'Dark',
    data: 'Data',
    editor: 'Editor',
    editorFontSize: 'Editor font size',
    exportAll: 'Export all…',
    exportLibrary: 'Export library',
    exportHint: 'Save all notes as Markdown files',
    exporting: 'Exporting…',
    fontSize: 'Font size',
    language: 'Language',
    light: 'Light',
    system: 'System',
    title: 'Settings',
    languageSystem: 'System Default',
    languageKorean: '한국어',
    languageEnglish: 'English',
  },
  editor: {
    formatting: 'Formatting',
    bold: 'Bold',
    italic: 'Italic',
    strike: 'Strike',
    inlineCode: 'Inline code',
    link: 'Link',
    linkUrl: 'Link URL',
    applyLink: 'Apply link',
    apply: 'Apply',
    removeLink: 'Remove link',
    remove: 'Remove',
    cancelLink: 'Cancel link',
    invalidUrl: 'Please enter a valid web URL (http:// or https://)',
    slashMenu: 'Slash commands',
    noMatchingCommands: 'No matching commands',
    taskCheckbox: (text: string) => `Task item checkbox for ${text}`,
    emptyTask: 'empty task item',
  },
  slash: {
    text: 'Text',
    heading1: 'Heading 1',
    heading2: 'Heading 2',
    heading3: 'Heading 3',
    bulletList: 'Bullet list',
    numberedList: 'Numbered list',
    todoList: 'Todo list',
    quote: 'Quote',
    codeBlock: 'Code block',
    divider: 'Divider',
  },
  dialogs: {
    noteTrashTitle: 'Move note to Trash?',
    noteTrashBody: 'You can restore it from Trash.',
    folderTrashTitle: 'Move folder to Trash?',
    folderTrashBody: (count: number) => `This folder and ${count} notes will be moved to Trash.`,
    permanentNoteTitle: 'Delete this note permanently?',
    cannotUndo: 'This cannot be undone.',
    permanentFolderTitle: 'Delete this folder permanently?',
    permanentFolderBody: (count: number) => `This folder and ${count} notes will be permanently deleted. This cannot be undone.`,
    emptyTrashTitle: 'Empty Trash?',
    emptyTrashConfirm: 'Empty Trash',
    emptyTrashBody: (noteCount: number, folderCount: number) => `Permanently delete ${noteCount} notes and ${folderCount} folders. This cannot be undone.`,
    moveToTrash: 'Move to Trash',
    deletePermanently: 'Delete permanently',
    saveTransitionTitle: 'Changes couldn’t be saved',
    saveTransitionBody: 'Flashnote couldn’t save your latest changes. Stay here to keep working on this note, retry saving, or discard the unsaved changes and continue.',
    stayHere: 'Stay here',
    retrySaving: 'Retry saving',
    discardAndContinue: 'Discard changes & continue',
    closeTitle: 'Changes aren’t saved',
    closeBody: 'Flashnote couldn’t save your latest changes. Retry saving, keep the window open, or discard those unsaved changes and exit.',
    discardAndExit: 'Discard & exit',
  },
  status: {
    exportSucceeded: 'Library exported successfully.',
    exportFailed: 'Export failed.',
    exportBlocked: 'Flashnote library export blocked: current draft could not be durably saved.',
    imageInsertFailed: 'Could not insert image.',
    noteMovedToTrash: 'Note moved to Trash',
    saveRetrying: 'Changes aren’t saved. Flashnote will keep retrying.',
    saveBlocked: 'This document could not be saved in its current form. Reduce its content and try again.',
    saveTimedOut: 'Save timed out',
    undo: 'Undo',
  },
  errors: {
    couldNotCreateFolder: 'Could not create folder.',
    couldNotCreateNote: 'Could not create note.',
    couldNotEmptyTrash: 'Could not empty Trash.',
    couldNotLeaveTrash: 'Could not leave Trash.',
    couldNotMoveFolderToTrash: 'Could not move folder to Trash.',
    couldNotMoveNote: 'Could not move note.',
    couldNotMoveNoteToTrash: 'Could not move note to Trash.',
    couldNotOpenFolder: 'Could not open folder.',
    couldNotOpenNote: 'Could not open note.',
    couldNotOpenTrash: 'Could not open Trash.',
    couldNotOpenTrashFolder: 'Could not open trashed folder.',
    couldNotOpenTrashNote: 'Could not open trashed note.',
    couldNotPermanentlyDeleteFolder: 'Could not permanently delete folder.',
    couldNotPermanentlyDeleteNote: 'Could not permanently delete note.',
    couldNotRefreshNotes: 'Could not refresh notes.',
    couldNotRestoreNote: 'Could not restore note.',
    couldNotRestoreTrashItem: 'Could not restore Trash item.',
    startupFailed: 'Flashnote could not open your note.',
  },
  export: {
    markdownFiles: 'Markdown Files',
    failedTitle: 'Export Failed',
    failedMessage: 'The export could not be completed.',
  },
} as const

export type Messages = Widen<typeof englishMessages>

const koreanMessages = {
  common: {
    cancel: '취소',
    close: '닫기',
    emptyFolder: '빈 폴더',
    folder: '폴더',
    folderName: '폴더 이름',
    notes: '노트',
    root: '루트',
    rootNotes: '루트 노트',
    trash: '휴지통',
    trashEmpty: '휴지통이 비어 있습니다',
    untitled: '제목 없음',
  },
  sidebar: {
    backToNotes: '노트로 돌아가기',
    create: '만들기',
    editor: '편집기',
    hideSidebar: '사이드바 숨기기',
    moveFolderToTrash: '폴더를 휴지통으로 이동',
    moveNote: '노트 이동',
    moveNoteToTrash: '노트를 휴지통으로 이동',
    moveToTrash: '휴지통으로 이동',
    newFolder: '새 폴더',
    newNote: '새 노트',
    noteList: '노트 목록',
    opening: '여는 중…',
    settings: '설정',
    showSidebar: '사이드바 표시',
    trashActions: '휴지통 작업',
    trashNotes: '휴지통 노트',
    trashViewer: '휴지통 뷰어',
    emptyTrash: '휴지통 비우기…',
    folderLabel: (name: string) => `${name} 폴더`,
  },
  document: {
    deleteFolderPermanently: '폴더 영구 삭제…',
    deletePermanently: '영구 삭제…',
    deletedFolderEmpty: '삭제된 폴더는 비어 있습니다.',
    exportMarkdown: 'Markdown으로 내보내기…',
    folderRecoveryReadOnly: '폴더 복구 묶음 · 읽기 전용',
    more: '더 보기',
    moreActions: '추가 작업',
    noteTitle: '노트 제목',
    opening: '노트 여는 중…',
    readOnlyInTrash: '휴지통에서 읽기 전용',
    restore: '복구',
    restoreFolder: '폴더 복구',
    trashEmptyBody: '삭제한 노트와 폴더는 복구하거나 영구 삭제할 때까지 여기에 보관됩니다.',
  },
  search: {
    noMatches: '검색 결과가 없습니다',
    placeholder: '노트 검색',
    recentlyModified: '최근 수정',
    results: '검색 결과',
    title: '노트 검색',
    unavailable: '지금은 노트를 검색할 수 없습니다.',
  },
  settingsPage: {
    appearance: '화면 모드',
    appearanceTheme: '화면 모드',
    close: '설정 닫기',
    dark: '다크',
    data: '데이터',
    editor: '편집기',
    editorFontSize: '편집기 글꼴 크기',
    exportAll: '모두 내보내기…',
    exportLibrary: '라이브러리 내보내기',
    exportHint: '모든 노트를 Markdown 파일로 저장',
    exporting: '내보내는 중…',
    fontSize: '글꼴 크기',
    language: '언어',
    light: '라이트',
    system: '시스템',
    title: '설정',
    languageSystem: '시스템 기본값',
    languageKorean: '한국어',
    languageEnglish: 'English',
  },
  editor: {
    formatting: '서식',
    bold: '굵게',
    italic: '기울임꼴',
    strike: '취소선',
    inlineCode: '인라인 코드',
    link: '링크',
    linkUrl: '링크 URL',
    applyLink: '링크 적용',
    apply: '적용',
    removeLink: '링크 제거',
    remove: '제거',
    cancelLink: '링크 편집 취소',
    invalidUrl: '올바른 웹 URL을 입력하세요(http:// 또는 https://)',
    slashMenu: '슬래시 명령',
    noMatchingCommands: '일치하는 명령이 없습니다',
    taskCheckbox: (text: string) => `${text} 할 일 체크박스`,
    emptyTask: '빈 할 일 항목',
  },
  slash: {
    text: '텍스트',
    heading1: '제목 1',
    heading2: '제목 2',
    heading3: '제목 3',
    bulletList: '글머리 기호 목록',
    numberedList: '번호 목록',
    todoList: '할 일 목록',
    quote: '인용문',
    codeBlock: '코드 블록',
    divider: '구분선',
  },
  dialogs: {
    noteTrashTitle: '노트를 휴지통으로 옮길까요?',
    noteTrashBody: '휴지통에서 복구할 수 있습니다.',
    folderTrashTitle: '폴더를 휴지통으로 옮길까요?',
    folderTrashBody: (count: number) => `이 폴더와 노트 ${count}개를 휴지통으로 옮깁니다.`,
    permanentNoteTitle: '이 노트를 영구 삭제할까요?',
    cannotUndo: '이 작업은 취소할 수 없습니다.',
    permanentFolderTitle: '이 폴더를 영구 삭제할까요?',
    permanentFolderBody: (count: number) => `이 폴더와 노트 ${count}개를 영구 삭제합니다. 이 작업은 취소할 수 없습니다.`,
    emptyTrashTitle: '휴지통을 비울까요?',
    emptyTrashConfirm: '휴지통 비우기',
    emptyTrashBody: (noteCount: number, folderCount: number) => `노트 ${noteCount}개와 폴더 ${folderCount}개를 영구 삭제합니다. 이 작업은 취소할 수 없습니다.`,
    moveToTrash: '휴지통으로 이동',
    deletePermanently: '영구 삭제',
    saveTransitionTitle: '변경 사항을 저장할 수 없음',
    saveTransitionBody: 'Flashnote가 최신 변경 사항을 저장하지 못했습니다. 이 노트에서 계속 작업하거나, 다시 저장하거나, 저장하지 않은 변경 사항을 버리고 계속할 수 있습니다.',
    stayHere: '여기서 계속',
    retrySaving: '다시 저장',
    discardAndContinue: '변경 사항을 버리고 계속',
    closeTitle: '변경 사항이 저장되지 않음',
    closeBody: 'Flashnote가 최신 변경 사항을 저장하지 못했습니다. 다시 저장하거나, 창을 닫지 않은 채 계속하거나, 저장하지 않은 변경 사항을 버리고 종료할 수 있습니다.',
    discardAndExit: '변경 사항을 버리고 종료',
  },
  status: {
    exportSucceeded: '라이브러리를 내보냈습니다.',
    exportFailed: '내보내지 못했습니다.',
    exportBlocked: '현재 초안을 안정적으로 저장할 수 없어 라이브러리 내보내기를 중단했습니다.',
    imageInsertFailed: '이미지를 삽입할 수 없습니다.',
    noteMovedToTrash: '노트를 휴지통으로 옮겼습니다',
    saveRetrying: '변경 사항이 저장되지 않았습니다. Flashnote가 계속 다시 시도합니다.',
    saveBlocked: '현재 내용으로는 이 문서를 저장할 수 없습니다. 내용을 줄인 뒤 다시 시도해 주세요.',
    saveTimedOut: '저장 시간이 초과되었습니다',
    undo: '실행 취소',
  },
  errors: {
    couldNotCreateFolder: '폴더를 만들 수 없습니다.',
    couldNotCreateNote: '노트를 만들 수 없습니다.',
    couldNotEmptyTrash: '휴지통을 비울 수 없습니다.',
    couldNotLeaveTrash: '휴지통에서 나갈 수 없습니다.',
    couldNotMoveFolderToTrash: '폴더를 휴지통으로 옮길 수 없습니다.',
    couldNotMoveNote: '노트를 옮길 수 없습니다.',
    couldNotMoveNoteToTrash: '노트를 휴지통으로 옮길 수 없습니다.',
    couldNotOpenFolder: '폴더를 열 수 없습니다.',
    couldNotOpenNote: '노트를 열 수 없습니다.',
    couldNotOpenTrash: '휴지통을 열 수 없습니다.',
    couldNotOpenTrashFolder: '삭제된 폴더를 열 수 없습니다.',
    couldNotOpenTrashNote: '삭제된 노트를 열 수 없습니다.',
    couldNotPermanentlyDeleteFolder: '폴더를 영구 삭제할 수 없습니다.',
    couldNotPermanentlyDeleteNote: '노트를 영구 삭제할 수 없습니다.',
    couldNotRefreshNotes: '노트 목록을 새로 고칠 수 없습니다.',
    couldNotRestoreNote: '노트를 복구할 수 없습니다.',
    couldNotRestoreTrashItem: '휴지통 항목을 복구할 수 없습니다.',
    startupFailed: 'Flashnote에서 노트를 열 수 없습니다.',
  },
  export: {
    markdownFiles: 'Markdown 파일',
    failedTitle: '내보내기 실패',
    failedMessage: '내보내기를 완료하지 못했습니다.',
  },
} satisfies Messages

const messagesByLanguage: Record<ResolvedLanguage, Messages> = {
  en: englishMessages,
  ko: koreanMessages,
}

export function getMessages(language: ResolvedLanguage): Messages {
  return messagesByLanguage[language]
}

export function normalizeLanguageTag(value: unknown): ResolvedLanguage {
  if (typeof value !== 'string') {
    return 'en'
  }
  const normalized = value.trim().toLowerCase()
  if (normalized === 'ko' || normalized.startsWith('ko-')) {
    return 'ko'
  }
  return 'en'
}

export function systemLanguageTag(): string | null {
  if (typeof navigator === 'undefined') {
    return null
  }
  const preferred = Array.isArray(navigator.languages) ? navigator.languages[0] : undefined
  return preferred || navigator.language || null
}

export function resolveLanguage(
  preference: LanguagePreference,
  systemTag: string | null = systemLanguageTag(),
): ResolvedLanguage {
  return preference === 'system' ? normalizeLanguageTag(systemTag) : preference
}

export function presentNoteTitle(
  displayTitle: string,
  isGeneratedFallback: boolean,
  language: ResolvedLanguage,
): string {
  return isGeneratedFallback ? getMessages(language).common.untitled : displayTitle
}

export function exportPresentation(language: ResolvedLanguage) {
  const messages = getMessages(language)
  return {
    markdownFiles: messages.export.markdownFiles,
    failedTitle: messages.export.failedTitle,
    failedMessage: messages.export.failedMessage,
  }
}
