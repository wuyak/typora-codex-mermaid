import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PERL = Path("/usr/bin/perl")
MANAGE = ROOT / "scripts" / "manage.pl"
PACKAGE_FILES = ("main.js", "engine.js", "renderer.js", "viewer.js", "manifest.json", "NOTICE", "THIRD_PARTY_NOTICES.txt")


class InstallerLifecycleTests(unittest.TestCase):
    def setUp(self):
        if not PERL.is_file() or not PERL.stat().st_mode & 0o111:
            self.skipTest("/usr/bin/perl is required for the standalone installer")
        self.temp = tempfile.TemporaryDirectory()
        self.workspace = Path(self.temp.name) / "应用 bundle with spaces"
        self.index = self.workspace / "TypeMark" / "index.html"
        self.user_data = self.workspace / "用户 data with spaces"
        self.source_root = self.workspace / "source package"
        self.index.parent.mkdir(parents=True)
        dist = self.source_root / "dist"
        dist.mkdir(parents=True)
        for name in PACKAGE_FILES:
            (dist / name).write_text(f"synthetic payload: {name}\n", encoding="utf-8")
        self.index.write_text("<!doctype html><body><p>clean app</p></body>", encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def run_manager(self, command, *extra, check=False):
        result = subprocess.run(
            [str(PERL), str(MANAGE), command, "--source-root", str(self.source_root), "--app-index", str(self.index), "--user-data", str(self.user_data), *extra],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if check:
            self.assertEqual(result.returncode, 0, result.stderr)
        return result

    @property
    def plugin_dir(self):
        return self.user_data / "codex-mermaid"

    @property
    def state_path(self):
        return self.user_data / ".codex-mermaid-standalone" / "state.json"

    def install(self):
        return self.run_manager("install", check=True)

    def uninstall(self):
        return self.run_manager("uninstall", check=True)

    def test_install_twice_then_uninstall_restores_clean_entry(self):
        clean = self.index.read_bytes()
        self.install()
        self.install()
        current = self.index.read_bytes()
        self.assertEqual(current.count(b"codex-mermaid-loader:start"), 1)
        self.assertEqual(current.count(b"codex-mermaid-loader:end"), 1)
        self.assertEqual(sorted(path.name for path in self.plugin_dir.iterdir()), sorted(PACKAGE_FILES))

        self.uninstall()
        self.assertEqual(self.index.read_bytes(), clean)
        self.assertFalse(self.plugin_dir.exists())
        self.assertTrue(self.state_path.is_file())
        self.assertEqual(json.loads(self.state_path.read_text())["uninstalled"], True)

    def test_existing_python_schema2_state_remains_usable(self):
        self.install()
        state = json.loads(self.state_path.read_text())
        self.assertEqual(state["schema"], 2)
        # Python's json module writes the same schema-2 fields with a different
        # formatting and key order. The Perl manager must consume that state.
        self.state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        retry = self.run_manager("install")
        self.assertEqual(retry.returncode, 0, retry.stderr)

    def test_upgrade_reinstall_then_uninstall_preserves_upgraded_clean_entry(self):
        self.install()
        upgraded = b"<!doctype html><body><p>upgraded app</p><script>window.appUpgrade=2;</script></body>"
        # The application update replaces the entry while the plugin remains
        # installed. Reinstall must create a new clean backup for this entry.
        self.index.write_bytes(upgraded)

        self.install()
        self.uninstall()
        self.assertEqual(self.index.read_bytes(), upgraded)

    def test_changed_installed_file_refuses_reinstall(self):
        self.install()
        installed = self.plugin_dir / "main.js"
        installed.write_bytes(installed.read_bytes() + b"\nuser edit\n")

        retry = self.run_manager("install")
        self.assertNotEqual(retry.returncode, 0)
        self.assertIn("Plugin file changed outside installer", retry.stderr)

    def test_unknown_loader_refuses_install_without_touching_index(self):
        unknown = b"<!doctype html><body>\n<!-- codex-mermaid-loader:start -->\n<script>unknown()</script>\n<!-- codex-mermaid-loader:end -->\n</body>"
        self.index.write_bytes(unknown)

        result = self.run_manager("install")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("no active ownership record", result.stderr)
        self.assertEqual(self.index.read_bytes(), unknown)
        self.assertFalse(self.user_data.exists())

    def test_uninstall_after_index_edit_removes_only_owned_loader(self):
        self.install()
        edited = self.index.read_bytes().replace(b"</body>", b"<p>user edit</p></body>")
        self.index.write_bytes(edited)

        self.uninstall()
        self.assertEqual(self.index.read_bytes(), b"<!doctype html><body><p>clean app</p><p>user edit</p></body>")

    def test_uninstall_retains_a_modified_installed_file(self):
        self.install()
        installed = self.plugin_dir / "main.js"
        changed = installed.read_bytes() + b"\nuser edit\n"
        installed.write_bytes(changed)

        self.uninstall()
        self.assertEqual(installed.read_bytes(), changed)
        self.assertFalse((self.plugin_dir / "engine.js").exists())
        state = json.loads(self.state_path.read_text())
        self.assertEqual(state["uninstalled"], True)

    def test_failed_install_does_not_replace_entry_without_closing_body(self):
        before = b"<!doctype html><html><body><p>no closing marker"
        self.index.write_bytes(before)
        result = self.run_manager("install")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("No closing body tag", result.stderr)
        self.assertEqual(self.index.read_bytes(), before)
        self.assertFalse(self.user_data.exists())

    def test_install_rolls_back_package_files_when_entry_write_fails(self):
        self.install()
        before_index = self.index.read_bytes()
        before_plugin = {name: (self.plugin_dir / name).read_bytes() for name in PACKAGE_FILES}
        (self.source_root / "dist" / "main.js").write_text("new payload after package update\n", encoding="utf-8")
        parent_mode = self.index.parent.stat().st_mode & 0o777
        self.index.parent.chmod(parent_mode & ~0o222)
        try:
            result = self.run_manager("install")
        finally:
            self.index.parent.chmod(parent_mode)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.index.read_bytes(), before_index)
        self.assertEqual({name: (self.plugin_dir / name).read_bytes() for name in PACKAGE_FILES}, before_plugin)

    def test_command_wrappers_use_system_perl_and_accept_custom_paths(self):
        # Run a complete temporary package, as a downloaded ZIP would, without
        # depending on generated dist files in the developer's checkout.
        (self.source_root / "scripts").mkdir()
        shutil.copy2(MANAGE, self.source_root / "scripts" / "manage.pl")
        for name in ("Install.command", "Uninstall.command"):
            shutil.copy2(ROOT / name, self.source_root / name)
        install = subprocess.run(
            [str(self.source_root / "Install.command"), "--app-index", str(self.index), "--user-data", str(self.user_data)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(install.returncode, 0, install.stderr)
        self.assertEqual((self.plugin_dir / "main.js").read_bytes(), (self.source_root / "dist" / "main.js").read_bytes())
        uninstall = subprocess.run(
            [str(self.source_root / "Uninstall.command"), "--app-index", str(self.index), "--user-data", str(self.user_data)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(uninstall.returncode, 0, uninstall.stderr)
        self.assertEqual(self.index.read_text(encoding="utf-8"), "<!doctype html><body><p>clean app</p></body>")


if __name__ == "__main__":
    unittest.main()
