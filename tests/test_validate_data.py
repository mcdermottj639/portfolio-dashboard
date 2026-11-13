"""Synthetic regressions for the offline publication gate; no owner records."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('validate_data', Path(__file__).resolve().parents[1] / 'scripts/validate-data.py')
VALIDATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VALIDATOR)


class DataValidationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.path = self.root / 'data.json'

    def tearDown(self):
        self.temp.cleanup()

    def check(self, raw):
        self.path.write_bytes(raw if isinstance(raw, bytes) else raw.encode())
        VALIDATOR.validate_file(self.path)

    def test_object_and_array(self):
        for raw in ['{"v":1,"unknown":null}', '[{"v":0}]', '{}', '[]']:
            with self.subTest(raw=raw):
                self.check(raw)

    def test_unicode_and_encrypted_text_are_opaque(self):
        self.check(json.dumps({'note': 'café', 'encrypted': 'opaque-not-decrypted'}))

    def test_duplicate_keys_rejected_at_any_depth(self):
        for raw in ['{"a":1,"a":2}', '{"a":[{"v":1,"v":2}]}', '{"a":1,"\\u0061":2}']:
            with self.subTest(raw=raw), self.assertRaises(VALIDATOR.DataError):
                self.check(raw)

    def test_same_key_in_separate_objects_allowed(self):
        self.check('[{"v":1},{"v":2}]')

    def test_non_finite_values_rejected(self):
        for raw in ['{"v":NaN}', '{"v":Infinity}', '{"v":-Infinity}', '{"v":1e999}', '{"v":-1e999}']:
            with self.subTest(raw=raw), self.assertRaises(VALIDATOR.DataError):
                self.check(raw)

    def test_integer_form_overflow_rejected(self):
        for sign in ['', '-']:
            with self.subTest(sign=sign), self.assertRaises(VALIDATOR.DataError):
                self.check('{"v":' + sign + '9' * 400 + '}')

    def test_large_but_finite_integer_allowed(self):
        for sign in ['', '-']:
            with self.subTest(sign=sign):
                self.check('{"v":' + sign + '1' + '0' * 308 + '}')

    def test_valid_finite_numbers(self):
        self.check('{"v":[0,-1,1.25,1e10,1e-10]}')

    def test_malformed_json_rejected_without_echo(self):
        with self.assertRaises(VALIDATOR.DataError) as error:
            self.check('{"private-secret-marker": invalid}')
        self.assertNotIn('private-secret-marker', str(error.exception))
        self.assertIn('line 1', str(error.exception))

    def test_duplicate_key_not_echoed(self):
        with self.assertRaises(VALIDATOR.DataError) as error:
            self.check('{"private-secret-marker":1,"private-secret-marker":2}')
        self.assertNotIn('private-secret-marker', str(error.exception))

    def test_bad_encoding(self):
        with self.assertRaises(VALIDATOR.DataError):
            self.check(b'{"v":"\xff"}')

    def test_missing_file(self):
        with self.assertRaises(VALIDATOR.DataError):
            VALIDATOR.validate_file(self.path)

    def test_scalar_roots_rejected(self):
        for raw in ['null', '1', 'true', '"text"']:
            with self.subTest(raw=raw), self.assertRaises(VALIDATOR.DataError):
                self.check(raw)

    def test_default_selection_retains_required_feeds(self):
        selected = VALIDATOR.selected_files(self.root, [])
        self.assertEqual({p.relative_to(self.root).as_posix() for p in selected}, set(VALIDATOR.REQUIRED))

    def test_default_selection_includes_new_nested_feed(self):
        (self.root / 'data/new').mkdir(parents=True)
        (self.root / 'data/new/feed.json').write_text('{}')
        self.assertIn(self.root / 'data/new/feed.json', VALIDATOR.selected_files(self.root, []))

    def test_selected_file_does_not_require_other_feeds(self):
        self.assertEqual(VALIDATOR.selected_files(self.root, ['data/predictions.json']), [self.root / 'data/predictions.json'])

    def test_escape_and_unrelated_paths_rejected(self):
        for name in ['../outside.json', '/tmp/outside.json', 'producer/research.json', 'data/file.txt']:
            with self.subTest(name=name), self.assertRaises(VALIDATOR.DataError):
                VALIDATOR.selected_files(self.root, [name])

    def test_symlink_rejected(self):
        target = self.root / 'target.json'
        target.write_text('{}')
        self.path.symlink_to(target)
        with self.assertRaises(VALIDATOR.DataError):
            VALIDATOR.validate_file(self.path)
        with self.assertRaises(VALIDATOR.DataError):
            VALIDATOR.selected_files(self.root, ['data.json'])


if __name__ == '__main__':
    unittest.main()
