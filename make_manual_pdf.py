from __future__ import annotations

from pathlib import Path

from PIL import Image as PILImage, ImageDraw, ImageFont
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch, cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Image,
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parent
OUT_PDF = ROOT / "receipt-app_사용매뉴얼.pdf"
FONT_REG = "/Users/kyounghomac/Library/Fonts/NanumGothic.ttf"
COMPOSITE_DIR = Path("/tmp/receipt_manual_composites")
KAKAO_CHAT_LIST = Path(
    "/Users/kyounghomac/Pictures/Photos Library.photoslibrary/resources/renders/D/"
    "D0F951ED-0B1B-4507-9F14-85104F191324_1_201_a.jpeg"
)
KAKAO_CHAT_ROOM = Path(
    "/Users/kyounghomac/Pictures/Photos Library.photoslibrary/originals/8/"
    "8DA6DE91-0118-4C75-BD4A-AD99BB714430.png"
)
KAKAO_CHAT_MENU = Path(
    "/Users/kyounghomac/Pictures/Photos Library.photoslibrary/resources/renders/2/"
    "25DB2BB4-B80B-4A4B-8194-84909CF4A82A_1_201_a.jpeg"
)
KAKAO_MEMBER_LIST = Path(
    "/Users/kyounghomac/Pictures/Photos Library.photoslibrary/resources/renders/9/"
    "9C38D8C4-3881-41DF-BE4C-2F9EDF8C2426_1_201_a.jpeg"
)


def shot_path(stem: str) -> Path:
    for candidate in sorted(ROOT.glob(f"{stem}.*")):
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(f"Missing screenshot for {stem}")


ORDERED_STEPS = [
    {
        "stem": "000",
        "title": "000. 담당 조 선택",
        "summary": "앱을 처음 열면 담당 조를 먼저 선택합니다. 이 선택이 이후 예산, 입력, 마감의 기준이 됩니다.",
        "bullets": [
            "처음 선택한 조는 이후 설정에서 다시 바꿀 수 있습니다.",
            "사용자는 먼저 자신이 속한 조를 정하고 다음 단계로 이동합니다.",
        ],
    },
    {
        "stem": "001_002",
        "title": "001. 예산 설정과 새 출장 시작 확인",
        "summary": "예산 설정 화면에서 기간을 잡은 뒤, 아래쪽의 펼치기 버튼을 눌러 새 출장 시작 확인 화면을 엽니다. 이 두 단계는 한 흐름으로 이어집니다.",
        "bullets": [
            "달력으로 출장 시작일과 종료일을 지정합니다.",
            "예산 직접 입력 칸에는 계산된 값이 기본으로 들어갑니다.",
            "화면 맨 아래의 '새 출장 시작 (영수증 모두 삭제)' 줄은 접혀 있습니다.",
            "오른쪽 '펼치기' 버튼을 눌러야 새 출장 시작 확인 화면이 나타납니다.",
            "새 출장 시작은 기존 영수증을 모두 지우는 동작이므로, 반드시 기간을 다시 확인한 뒤 실행합니다.",
        ],
    },
    {
        "stem": "003",
        "title": "003. 입력 탭",
        "summary": "메인 화면의 입력 탭에서 촬영, 업로드, 직접입력 중 하나를 고릅니다.",
        "bullets": [
            "촬영은 바로 카메라를 열어 영수증을 넣는 방식입니다.",
            "업로드는 이미 찍어둔 사진을 넣는 방식입니다.",
            "직접입력은 OCR이 어려운 경우 수동으로 넣는 예외용입니다.",
        ],
    },
    {
        "stem": "004",
        "title": "004. 마감 탭",
        "summary": "마감 탭에서는 담당자에게 보내기와 Drive 저장으로 넘어갑니다.",
        "bullets": [
            "여기서 중요한 버튼은 '담당자에게 보내기'와 'Drive 저장'입니다.",
            "보내기와 저장은 순서대로 진행하는 것이 이해하기 쉽습니다.",
        ],
    },
    {
        "stem": "005",
        "title": "005. 카카오톡 전송 화면",
        "summary": "담당자에게 보내기를 누르면 핸드폰의 공유화면이 열립니다. 여기서 카카오톡을 선택한 뒤 유수림씨가 보이는 화면으로 이어집니다.",
        "bullets": [
            "핸드폰의 공유 화면에서 카카오톡을 선택합니다.",
            "다음 화면에서 유수림씨가 보이는지 먼저 확인합니다.",
            "유수림씨가 바로 보이지 않으면 목록을 아래로 더 내려서 찾습니다.",
        ],
    },
    {
        "stem": "006",
        "title": "006. 카톡 상대방 설정 1",
        "summary": "카톡 대화방 목록에서 '2026년 산림물지도 제작 현장조사'를 찾고, 그 안으로 들어가는 첫 단계입니다.",
        "bullets": [
            "채팅 목록에서 '2026년 산림물지도 제작 현장조사' 방을 찾습니다.",
            "방 화면 오른쪽 위의 검색과 메뉴 버튼을 먼저 확인합니다.",
            "상대가 많아 보일 때는 바로 전송하지 말고 목록을 천천히 살핍니다.",
        ],
    },
    {
        "stem": "007",
        "title": "007. 카톡 상대방 설정 2",
        "summary": "멤버 목록에서 유수림씨를 찾고 선택하는 단계입니다.",
        "bullets": [
            "멤버 목록을 아래로 더 내려서 유수림씨를 찾습니다.",
            "유수림씨 줄이 보이면 그 이름을 눌러 선택합니다.",
            "선택이 끝나면 전송을 눌러 보냅니다.",
        ],
    },
    {
        "stem": "008",
        "title": "008. Drive 저장 확인",
        "summary": "Drive 저장 전에 한 번 더 확인하는 대화상자가 나타납니다. 여기서 확인을 눌러야 실제 업로드가 진행됩니다.",
        "bullets": [
            "확인 대화상자에서는 업로드 개수와 대상이 표시됩니다.",
            "내용이 맞으면 확인을 누릅니다.",
        ],
    },
    {
        "stem": "009",
        "title": "009. 처리 중 상태",
        "summary": "업로드가 진행되면 완료 전 상태가 보입니다. 이 화면에서는 잠시 기다렸다가 완료 표시를 확인합니다.",
        "bullets": [
            "진행 중 표시가 있으면 업로드가 아직 끝나지 않은 상태입니다.",
            "네트워크가 느리면 몇 초 더 기다린 뒤 다음 화면을 확인합니다.",
        ],
    },
    {
        "stem": "010",
        "title": "010. 완료 상태",
        "summary": "담당자 전송과 Drive 저장이 끝나면 완료 표시가 뜹니다. 이 시점부터는 다음 입력이나 다음 작업으로 넘어가면 됩니다.",
        "bullets": [
            "완료 표시가 보이면 현재 출장분 처리는 끝난 것입니다.",
            "보관 정보와 함께 관련 메모가 같이 남습니다.",
        ],
    },
    {
        "stem": "011",
        "title": "011. 최종 정리",
        "summary": "마지막 화면은 마감이 정리된 최종 상태입니다. 필요하면 여기서 앱을 닫고 다음 출장 기간의 입력을 준비합니다.",
        "bullets": [
            "마감이 완료되면 추가로 누를 버튼이 없습니다.",
            "다음 주기를 시작할 때는 예산 설정 화면에서 기간을 다시 잡습니다.",
        ],
    },
]


def register_fonts() -> None:
    pdfmetrics.registerFont(TTFont("NanumGothic", FONT_REG))


def composite_pair(stem_a: str, stem_b: str, out_name: str, label_a: str, label_b: str) -> Path:
    COMPOSITE_DIR.mkdir(parents=True, exist_ok=True)
    out = COMPOSITE_DIR / out_name
    img_a = PILImage.open(shot_path(stem_a)).convert("RGB")
    img_b = PILImage.open(shot_path(stem_b)).convert("RGB")
    target_h = max(img_a.height, img_b.height)
    new_a = img_a.resize((int(img_a.width * target_h / img_a.height), target_h))
    new_b = img_b.resize((int(img_b.width * target_h / img_b.height), target_h))
    gap = 36
    pad = 40
    label_h = 56
    width = new_a.width + new_b.width + gap + pad * 2
    height = target_h + pad * 2 + label_h
    canvas = PILImage.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.truetype(FONT_REG, 30)
    x1 = pad
    y1 = pad + label_h
    canvas.paste(new_a, (x1, y1))
    draw.text((x1, pad), label_a, fill=(31, 42, 68), font=font)
    x2 = x1 + new_a.width + gap
    canvas.paste(new_b, (x2, y1))
    draw.text((x2, pad), label_b, fill=(31, 42, 68), font=font)
    canvas.save(out)
    return out


def composite_images(path_a: Path, path_b: Path, out_name: str, label_a: str, label_b: str) -> Path:
    COMPOSITE_DIR.mkdir(parents=True, exist_ok=True)
    out = COMPOSITE_DIR / out_name
    img_a = PILImage.open(path_a).convert("RGB")
    img_b = PILImage.open(path_b).convert("RGB")
    target_h = max(img_a.height, img_b.height)
    new_a = img_a.resize((int(img_a.width * target_h / img_a.height), target_h))
    new_b = img_b.resize((int(img_b.width * target_h / img_b.height), target_h))
    gap = 36
    pad = 40
    label_h = 56
    width = new_a.width + new_b.width + gap + pad * 2
    height = target_h + pad * 2 + label_h
    canvas = PILImage.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.truetype(FONT_REG, 30)
    x1 = pad
    y1 = pad + label_h
    canvas.paste(new_a, (x1, y1))
    draw.text((x1, pad), label_a, fill=(31, 42, 68), font=font)
    x2 = x1 + new_a.width + gap
    canvas.paste(new_b, (x2, y1))
    draw.text((x2, pad), label_b, fill=(31, 42, 68), font=font)
    canvas.save(out)
    return out


def styles():
    s = getSampleStyleSheet()
    s.add(
        ParagraphStyle(
            name="TitleKR",
            parent=s["Title"],
            fontName="NanumGothic",
            fontSize=23,
            leading=29,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#1f2a44"),
            spaceAfter=10,
        )
    )
    s.add(
        ParagraphStyle(
            name="SubtitleKR",
            parent=s["BodyText"],
            fontName="NanumGothic",
            fontSize=10.5,
            leading=14,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#526072"),
            spaceAfter=14,
        )
    )
    s.add(
        ParagraphStyle(
            name="SectionKR",
            parent=s["Heading1"],
            fontName="NanumGothic",
            fontSize=16,
            leading=20,
            alignment=TA_LEFT,
            textColor=colors.HexColor("#1f2a44"),
            spaceAfter=6,
        )
    )
    s.add(
        ParagraphStyle(
            name="BodyKR",
            parent=s["BodyText"],
            fontName="NanumGothic",
            fontSize=10.2,
            leading=14.2,
            alignment=TA_LEFT,
            textColor=colors.HexColor("#1f1f1f"),
            spaceAfter=4,
        )
    )
    s.add(
        ParagraphStyle(
            name="CaptionKR",
            parent=s["BodyText"],
            fontName="NanumGothic",
            fontSize=9.2,
            leading=11.5,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#41506b"),
            spaceAfter=5,
        )
    )
    s.add(
        ParagraphStyle(
            name="SmallKR",
            parent=s["BodyText"],
            fontName="NanumGothic",
            fontSize=8.8,
            leading=11,
            alignment=TA_LEFT,
            textColor=colors.HexColor("#6b7280"),
            spaceAfter=3,
        )
    )
    return s


def fit_image(path: Path, max_w: float, max_h: float) -> Image:
    img = Image(str(path))
    ratio = img.imageHeight / float(img.imageWidth)
    draw_w = max_w
    draw_h = draw_w * ratio
    if draw_h > max_h:
        draw_h = max_h
        draw_w = draw_h / ratio
    img.drawWidth = draw_w
    img.drawHeight = draw_h
    return img


def framed_image(path: Path, max_w: float, max_h: float):
    img = fit_image(path, max_w, max_h)
    table = Table(
        [[img]],
        colWidths=[max_w + 0.18 * inch],
        rowHeights=[img.drawHeight + 0.18 * inch],
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.white),
                ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#d8dee9")),
                ("LEFTPADDING", (0, 0), (-1, -1), 0.09 * inch),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0.09 * inch),
                ("TOPPADDING", (0, 0), (-1, -1), 0.09 * inch),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0.09 * inch),
            ]
        )
    )
    return table


def bullet_list(style, items):
    return ListFlowable(
        [ListItem(Paragraph(item, style)) for item in items],
        bulletType="bullet",
        leftIndent=13,
        bulletFontName="NanumGothic",
    )


def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor("#d7dce7"))
    canvas.setLineWidth(0.5)
    canvas.line(doc.leftMargin, 0.6 * inch, A4[0] - doc.rightMargin, 0.6 * inch)
    canvas.setFont("NanumGothic", 8.5)
    canvas.setFillColor(colors.HexColor("#6b7280"))
    canvas.drawString(doc.leftMargin, 0.4 * inch, "receipt-app 사용 매뉴얼")
    canvas.drawRightString(A4[0] - doc.rightMargin, 0.4 * inch, f"{doc.page}")
    canvas.restoreState()


def build_pdf() -> None:
    register_fonts()
    s = styles()

    doc = SimpleDocTemplate(
        str(OUT_PDF),
        pagesize=A4,
        rightMargin=1.55 * cm,
        leftMargin=1.55 * cm,
        topMargin=1.3 * cm,
        bottomMargin=1.2 * cm,
        title="receipt-app 사용 매뉴얼",
        author="Codex",
    )

    story = []

    story.append(Spacer(1, 0.4 * inch))
    story.append(Paragraph("receipt-app 사용 매뉴얼", s["TitleKR"]))
    story.append(Paragraph("파일 번호 순서대로 정리한 전체 흐름 안내: 000 → 011", s["SubtitleKR"]))
    story.append(
        Table(
            [[Paragraph("핵심 흐름", s["BodyKR"])]],
            colWidths=[doc.width],
            style=TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#eef3ff")),
                    ("BOX", (0, 0), (-1, -1), 0.7, colors.HexColor("#c7d5ff")),
                    ("LEFTPADDING", (0, 0), (-1, -1), 10),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                    ("TOPPADDING", (0, 0), (-1, -1), 8),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ]
            ),
        )
    )
    story.append(
        bullet_list(
            s["BodyKR"],
            [
                "1. 담당 조를 선택한다.",
                "2. 예산과 출장기간을 설정한다.",
                "3. 촬영, 업로드, 직접입력으로 영수증을 넣는다.",
                "4. 마감에서 담당자에게 보내기와 Drive 저장을 진행한다.",
                "5. 카카오톡 전송은 단톡방 '2026년 산림물지도 제작 현장조사'에서 유수림씨를 선택하는 흐름으로 이해한다.",
            ],
        )
    )
    story.append(
        Paragraph(
            "아래 페이지는 파일 번호 순서로 다시 배치했습니다. 001과 002는 한 페이지에 묶었고, 003과 004는 각각 분리했습니다.",
            s["SmallKR"],
        )
    )

    for idx, step in enumerate(ORDERED_STEPS):
        story.append(PageBreak())
        story.append(Paragraph(step["title"], s["SectionKR"]))
        story.append(Paragraph(step["summary"], s["BodyKR"]))
        if step["stem"] == "001_002":
            story.append(
                Paragraph(
                    "하단의 '새 출장 시작 (영수증 모두 삭제)' 줄은 처음에는 접혀 있습니다. 오른쪽의 '펼치기' 버튼을 눌러야 새 출장 시작 확인 화면이 나타납니다.",
                    s["BodyKR"],
                )
            )
            story.append(
                framed_image(
                    composite_pair("001", "002", "001_002.png", "001", "002"),
                    max_w=6.95 * inch,
                    max_h=7.3 * inch,
                )
            )
        elif step["stem"] == "003":
            story.append(framed_image(shot_path("003"), max_w=3.85 * inch, max_h=7.9 * inch))
        elif step["stem"] == "004":
            story.append(framed_image(shot_path("004"), max_w=3.85 * inch, max_h=7.9 * inch))
        elif step["stem"] == "005":
            story.append(
                Table(
                    [[Paragraph("카카오 전송 절차", s["BodyKR"])]],
                    colWidths=[doc.width],
                    style=TableStyle(
                        [
                            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#fff7db")),
                            ("BOX", (0, 0), (-1, -1), 0.7, colors.HexColor("#d7b840")),
                            ("LEFTPADDING", (0, 0), (-1, -1), 10),
                            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                            ("TOPPADDING", (0, 0), (-1, -1), 8),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                        ]
                    ),
                )
            )
            story.append(
                bullet_list(
                    s["BodyKR"],
                    [
                        "담당자에게 보내기를 누르면 핸드폰의 공유 화면이 열린다.",
                    ],
                )
            )
            story.append(
                framed_image(
                    composite_images(
                        shot_path("005"),
                        KAKAO_MEMBER_LIST,
                        "005_kakao_select.png",
                        "핸드폰의 공유 화면",
                        "유수림씨 선택 화면",
                    ),
                    max_w=6.95 * inch,
                    max_h=7.9 * inch,
                )
            )
        elif step["stem"] == "006":
            story.append(
                framed_image(
                    composite_images(
                        KAKAO_CHAT_LIST,
                        KAKAO_CHAT_ROOM,
                        "006_chat_flow.png",
                        "카톡 채팅 목록",
                        "대화방 내부 화면",
                    ),
                    max_w=6.95 * inch,
                    max_h=7.9 * inch,
                )
            )
        elif step["stem"] == "007":
            story.append(
                framed_image(
                    composite_images(
                        KAKAO_CHAT_MENU,
                        KAKAO_MEMBER_LIST,
                        "007_chat_member.png",
                        "대화방 오른쪽 위 메뉴",
                        "멤버 목록에서 유수림씨 찾기",
                    ),
                    max_w=6.95 * inch,
                    max_h=7.9 * inch,
                )
            )
        elif step["stem"] == "008":
            story.append(framed_image(shot_path("007"), max_w=3.85 * inch, max_h=7.9 * inch))
        elif step["stem"] == "009":
            story.append(framed_image(shot_path("006"), max_w=3.85 * inch, max_h=7.9 * inch))
        elif step["stem"] == "010":
            story.append(framed_image(shot_path("009"), max_w=3.85 * inch, max_h=7.9 * inch))
        elif step["stem"] == "011":
            story.append(framed_image(shot_path("010"), max_w=3.85 * inch, max_h=7.9 * inch))
        else:
            story.append(framed_image(shot_path(step["stem"]), max_w=3.85 * inch, max_h=7.9 * inch))
        story.append(Spacer(1, 0.06 * inch))
        story.append(Paragraph(f"그림 {idx + 1}. {step['title']}", s["CaptionKR"]))
        story.append(bullet_list(s["BodyKR"], step["bullets"]))

    doc.build(story, onFirstPage=footer, onLaterPages=footer)


if __name__ == "__main__":
    build_pdf()
