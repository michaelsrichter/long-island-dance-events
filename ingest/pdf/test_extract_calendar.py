"""Golden-file test for the PDF calendar extractor.

Run: python -m unittest discover -s ingest/pdf -p "test_*.py"
Regenerate the golden file only after checking the new output by hand:
  python ingest/pdf/extract_calendar.py --pdf ingest/fixtures/tdc-sample.pdf --issue 2030-11 --out ingest/fixtures/tdc-sample.rows.json
"""
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from extract_calendar import extract, join_lines  # noqa: E402

FIXTURES = os.path.join(HERE, '..', 'fixtures')


class ExtractCalendarTest(unittest.TestCase):
    def setUp(self):
        self.result = extract(os.path.join(FIXTURES, 'tdc-sample.pdf'), '2030-11')

    def test_matches_golden_file(self):
        with open(os.path.join(FIXTURES, 'tdc-sample.rows.json'), encoding='utf-8') as f:
            golden = json.load(f)
        self.assertEqual(self.result['rows'], golden['rows'])

    def test_skips_ad_and_directory_pages(self):
        self.assertEqual(self.result['stats']['calendarPages'], [2, 3])
        self.assertFalse(any('Directory entry' in r['text'] for r in self.result['rows']))
        self.assertFalse(any('Harvest Ball' in r['text'] for r in self.result['rows']))

    def test_town_header_with_comma_does_not_bleed(self):
        towns = [r['town'] for r in self.result['rows']]
        self.assertIn('Little Neck, Queens', towns)
        first = self.result['rows'][0]['text']
        self.assertNotIn('Elsewhere', first)

    def test_joins_soft_hyphens_urls_and_page_breaks(self):
        texts = ' '.join(r['text'] for r in self.result['rows'])
        self.assertIn('desserts', texts)
        self.assertIn('www.practicestudio.example', texts)
        self.assertIn('keeps going into the next page', texts)
        self.assertNotIn('Ad pg', texts)

    def test_sections_and_dates(self):
        self.assertEqual([r['section'] for r in self.result['rows']], ['DANCES', 'DANCES', 'CLASSES', 'DANCES', 'SPECIAL'])
        self.assertEqual(self.result['rows'][-1]['date'], '2030-11-03')

    def test_join_lines_rules(self):
        self.assertEqual(join_lines(['info@', 'example.org']), 'info@example.org')
        self.assertEqual(join_lines(['danc-', 'ing tonight']), 'dancing tonight')
        self.assertEqual(join_lines(['Call now.', 'Ad pg 7']), 'Call now.')


if __name__ == '__main__':
    unittest.main()
