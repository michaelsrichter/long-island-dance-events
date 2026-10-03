#!/usr/bin/env python3
"""Build ingest/fixtures/tdc-sample.pdf: a small, fictional calendar in The Dance Calendar's layout.

It is synthetic on purpose (no copyrighted text) and exercises the hard parts of the real PDFs:
two columns, font-coded headers, a soft hyphen, a web address split across lines, an "Ad pg" note,
a town header with a comma, a listing that continues into the next column, an ad page with a
mixed-case date, and a directory page that must be skipped.

Run:  python ingest/fixtures/make_fixture_pdf.py
"""
import os

try:
    import pymupdf
except ImportError:  # pragma: no cover
    import fitz as pymupdf  # type: ignore

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'tdc-sample.pdf')

HEAVY = ('hebo', 13)
SECTION = ('hebo', 10)
TOWN = ('hebo', 10)
BODY = ('helv', 9.5)


def write(page, x, y, text, font):
    page.insert_text((x, y), text, fontname=font[0], fontsize=font[1])
    return y + (font[1] + 5)


def calendar_page(doc, left, right, number):
    page = doc.new_page(width=612, height=792)
    write(page, 40, 30, 'November 2030 Dance Calendar', ('helv', 20))
    write(page, 40, 50, '(Please call advertisers ahead to confirm)', ('hebo', 12))
    for x, items in ((18, left), (315, right)):
        y = 80
        for kind, text in items:
            y = write(page, x, y, text, {'day': HEAVY, 'section': SECTION, 'town': TOWN, 'body': BODY}[kind])
    write(page, 590, 785, str(number), ('hebo', 9))


def main():
    doc = pymupdf.open()
    # Page 1: an advertising page with a mixed-case date. It must not start a calendar day.
    ad = doc.new_page(width=612, height=792)
    write(ad, 60, 100, 'Saturday, Nov. 9', ('hebo', 16))
    write(ad, 60, 130, 'Harvest Ball with the Sample Orchestra. Call 555-0100.', ('helv', 11))

    calendar_page(doc, [
        ('day', 'FRIDAY NOV 1'),
        ('section', 'DANCES'),
        ('town', 'Huntington'),
        ('body', 'Example Lodge. 12 Fictional Ave. Ballroom & Latin'),
        ('body', 'social with DJ Sample. 7-11pm. $20pp includes des\u00ad'),
        ('body', 'serts. Info: 555-0101. Ad pg 5'),
        ('town', 'Little Neck, Queens'),
        ('body', 'Out-of-area Ballroom at 1 Elsewhere Rd. 2-5pm'),
        ('body', 'social. 555-0102.'),
        ('section', 'CLASSES'),
        ('town', 'Bay Shore'),
        ('body', 'Practice Studio. 99 Test St. 7pm Beginner West'),
        ('body', 'Coast Swing, 8pm Intermediate Hustle. No partner'),
        ('body', 'needed. $15. Info: www.'),
        ('body', 'practicestudio.example'),
    ], [
        ('day', 'SATURDAY NOV 2'),
        ('section', 'DANCES'),
        ('town', 'Huntington'),
        ('body', 'Swing night at Example Lodge, 12 Fictional Ave.'),
        ('body', 'East Coast Swing lesson at 7:30pm, live band at'),
        ('body', '8pm. $15/person. This listing keeps going'),
    ], 15)
    calendar_page(doc, [
        ('body', 'into the next page and must stay joined.'),
        ('day', 'SUNDAY NOV 3'),
        ('section', 'SPECIAL EVENTS'),
        ('town', 'Riverhead'),
        ('body', 'Argentine Tango milonga at Sample Hall, 5 Demo'),
        ('body', 'Rd. 6-10pm. Free.'),
    ], [], 16)
    # Directory page: same body font, no day header, no running header. Must be skipped.
    d = doc.new_page(width=612, height=792)
    write(d, 40, 100, 'Dancer\'s Directory', ('helv', 18))
    write(d, 40, 130, 'Huntington Dance Club', ('hebo', 10))
    write(d, 40, 145, 'Directory entry that must never become an event. 555-0199.', ('helv', 9.5))
    doc.set_metadata({'title': 'Synthetic test calendar', 'creator': 'long-island-dance-events tests'})
    doc.save(OUT, garbage=4, deflate=True)
    print(OUT)


if __name__ == '__main__':
    main()
