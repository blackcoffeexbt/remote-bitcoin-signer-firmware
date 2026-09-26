from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from pypdf import PdfReader
from pathlib import Path

OUT=Path('output/pdf')
W,H=148*mm,210*mm
INK=HexColor('#182126'); MUTED=HexColor('#526068'); RULE=HexColor('#A7AFB2'); ORANGE=HexColor('#C15B13')
def card(c):
    def txt(x,y,s,size=9,font='Helvetica',color=INK):
        c.setFillColor(color); c.setFont(font,size); c.drawString(x*mm,H-y*mm,s)
    def line(x1,y1,x2,y2,color=RULE,width=.55):
        c.setStrokeColor(color); c.setLineWidth(width); c.line(x1*mm,H-y1*mm,x2*mm,H-y2*mm)
    # Small accent, economical on ink and legible in monochrome.
    c.setFillColor(ORANGE); c.rect(10*mm,H-13*mm,8*mm,1.4*mm,fill=1,stroke=0)
    txt(21,13,'DEVICE COMPANION / PRIVATE RECORD',7.2,'Helvetica-Bold',MUTED)
    txt(10,25,'Remote Bitcoin signer',20,'Helvetica-Bold')
    txt(10,32,'PIN codes & wallet recovery',10,'Helvetica',MUTED)
    line(10,38,138,38,INK,.8)
    txt(10,46,'01 / PIN CODES',8,'Helvetica-Bold',ORANGE)
    txt(10,53,'Wallet PIN and settings PIN are different.',10,'Helvetica-Bold')
    txt(10,62,'Wallet PIN',11,'Helvetica-Bold')
    txt(83,62,'6-32 digits',8,'Helvetica',MUTED)
    txt(10,67,'Unlocks the wallet for signing.',8.5,'Helvetica',MUTED)
    line(10,78,138,78)
    txt(10,87,'Settings PIN',11,'Helvetica-Bold')
    txt(83,87,'6-32 digits',8,'Helvetica',MUTED)
    txt(10,92,'Opens device settings. Does not unlock the wallet.',8.5,'Helvetica',MUTED)
    line(10,103,138,103)
    txt(10,115,'02 / 12-WORD SEED PHRASE',8,'Helvetica-Bold',ORANGE)
    txt(10,122,'Write each word in its numbered space, in order.',8.5,'Helvetica',MUTED)
    for row in range(6):
        for col in range(2):
            n=col*6+row+1; x=10+col*67; y=133+row*10
            txt(x,y,f'{n:02d}',8,'Helvetica-Bold',MUTED)
            line(x+8,y+1,x+61,y+1)
    line(10,191,138,191,INK,.8)
    txt(10,198,'Store this completed card in a safe place.',8.5,'Helvetica-Bold')
    txt(10,203,'Keep the seed words private.',8,'Helvetica',MUTED)

p=OUT/'signer-companion-card-a5.pdf'
c=canvas.Canvas(str(p),pagesize=(W,H)); c.setTitle('Remote Bitcoin signer - companion card (A5)'); c.setAuthor('Remote Bitcoin signer'); card(c); c.showPage(); c.save()
p=OUT/'signer-companion-card-a4-print.pdf'
c=canvas.Canvas(str(p),pagesize=A4); c.setTitle('Remote Bitcoin signer - A4 print sheet'); c.setAuthor('Remote Bitcoin signer')
x=(A4[0]-W)/2; y=(A4[1]-H)/2
c.saveState(); c.translate(x,y); card(c); c.restoreState()
c.setStrokeColor(MUTED); c.setLineWidth(.4)
for cx in (x,x+W):
    for cy in (y,y+H):
        dx=-1 if cx==x else 1; dy=-1 if cy==y else 1
        c.line(cx+dx*2*mm,cy,cx+dx*6*mm,cy)
        c.line(cx,cy+dy*2*mm,cx,cy+dy*6*mm)
c.setFillColor(MUTED); c.setFont('Helvetica',8)
c.drawCentredString(A4[0]/2,22*mm,'Print at 100% / Actual size on A4. Cut at the corner marks. Finished size: 148 x 210 mm.')
c.showPage(); c.save()
for p in OUT.glob('signer-companion-card-*.pdf'):
    r=PdfReader(p); t=r.pages[0].extract_text()
    assert len(r.pages)==1 and 'Wallet PIN' in t and 'Settings PIN' in t
    assert all(f'{n:02d}' in t for n in range(1,13))
    print(p, 'validated', tuple(float(v) for v in r.pages[0].mediabox[2:]))
