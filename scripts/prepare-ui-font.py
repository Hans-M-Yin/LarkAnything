"""Create an offline Noto Sans SC subset covering GB2312 and all UI characters.
Original font and license: https://github.com/google/fonts/tree/main/ofl/notosanssc
Install fonttools[woff] into the build environment before running this script.
"""
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont
chars=set()
for hi in range(0xa1,0xf8):
    for lo in range(0xa1,0xff):
        try: chars.update(bytes([hi,lo]).decode('gb2312'))
        except UnicodeDecodeError: pass
for p in Path('desktop/ui').glob('*.tsx'): chars.update(p.read_text(encoding='utf-8'))
chars.update(chr(i) for i in range(0x3000,0x3040))
font=TTFont('.larkanything/font-sources/NotoSansSC.ttf')
options=subset.Options()
options.flavor='woff2'
sub=subset.Subsetter(options=options)
sub.populate(unicodes=[ord(c) for c in chars])
sub.subset(font)
for record in font['name'].names:
    if record.nameID in (1,4,6,16,17):
        value={1:'Lark UI CJK',4:'Lark UI CJK',6:'LarkUICJK',16:'Lark UI CJK',17:'Regular'}[record.nameID]
        record.string=value.encode(record.getEncoding(),errors='replace')
font.flavor='woff2'
font.save('desktop/assets/fonts/LarkUICJK.woff2')
print('Font subset bytes:',Path('desktop/assets/fonts/LarkUICJK.woff2').stat().st_size)
