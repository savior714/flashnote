from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text()
    if old not in text:
        raise SystemExit(f"expected source block not found in {path}")
    file_path.write_text(text.replace(old, new, 1))


replace_once(
    "frontend/src/App.svelte",
    '''<script lang="ts">
  import NoteEditor from './lib/NoteEditor.svelte'
</script>''',
    '''<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { GetRuntimeInfo } from '../bindings/github.com/savior714/flashnote/appservice'
  import NoteEditor from './lib/NoteEditor.svelte'

  async function verifyNativeRuntime() {
    await tick()
    const shell = document.querySelector('main.shell')
    const editorHost = document.querySelector('.editor-host')
    if (!shell || !editorHost) {
      throw new Error('Flashnote native UI did not mount')
    }

    const info = await GetRuntimeInfo()
    if (!info.databaseReady || info.schemaVersion < 1) {
      throw new Error('Flashnote runtime bridge returned invalid diagnostics')
    }
  }

  onMount(() => {
    void verifyNativeRuntime()
  })
</script>''',
)

replace_once(
    "app_service.go",
    'import (\n\t"context"\n',
    'import (\n\t"context"\n\t"log"\n',
)

replace_once(
    "app_service.go",
    '''\treturn RuntimeInfo{
\t\tAppVersion:    appVersion,
\t\tDatabaseReady: true,
\t\tSQLiteVersion: info.SQLiteVersion,
\t\tJournalMode:   info.JournalMode,
\t\tSynchronous:   info.Synchronous,
\t\tForeignKeys:   info.ForeignKeys,
\t\tSchemaVersion: info.SchemaVersion,
\t}, nil
''',
    '''\truntimeInfo := RuntimeInfo{
\t\tAppVersion:    appVersion,
\t\tDatabaseReady: true,
\t\tSQLiteVersion: info.SQLiteVersion,
\t\tJournalMode:   info.JournalMode,
\t\tSynchronous:   info.Synchronous,
\t\tForeignKeys:   info.ForeignKeys,
\t\tSchemaVersion: info.SchemaVersion,
\t}
\tlog.Printf(
\t\t"FLASHNOTE_RUNTIME_READY sqlite=%s journal=%s synchronous=%d foreign_keys=%t schema=%d",
\t\truntimeInfo.SQLiteVersion,
\t\truntimeInfo.JournalMode,
\t\truntimeInfo.Synchronous,
\t\truntimeInfo.ForeignKeys,
\t\truntimeInfo.SchemaVersion,
\t)
\treturn runtimeInfo, nil
''',
)

replace_once(
    "Taskfile.yml",
    "  frontend:check:\n    deps: [frontend:install]\n",
    "  frontend:check:\n    deps: [bindings]\n",
)
