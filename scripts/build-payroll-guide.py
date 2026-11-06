"""Build illustrated PDF and editable Word guide from local, synthetic CRM screenshots."""
from pathlib import Path
from html import escape
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image, PageBreak, Table, TableStyle, KeepTogether
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.pagesizes import A4
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from PIL import Image as PILImage
ROOT=Path(__file__).resolve().parent.parent
IMG=ROOT/'docs/testing/payroll-guide'; OUT=ROOT/'trial-ui/guides'; OUT.mkdir(parents=True,exist_ok=True)
pdfmetrics.registerFont(TTFont('VN','/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('VN-Bold','/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'))
styles=getSampleStyleSheet(); styles.add(ParagraphStyle(name='VNBody',fontName='VN',fontSize=10,leading=15,spaceAfter=7));styles.add(ParagraphStyle(name='VNTitle',fontName='VN-Bold',fontSize=20,leading=27,textColor=colors.HexColor('#102a56'),spaceAfter=13));styles.add(ParagraphStyle(name='VNSmall',fontName='VN',fontSize=8,leading=11,textColor=colors.HexColor('#53647b'),spaceAfter=7));styles.add(ParagraphStyle(name='VNSub',fontName='VN-Bold',fontSize=12,leading=17,textColor=colors.HexColor('#102a56'),spaceAfter=8))
sections=[
('HƯỚNG DẪN CÀI ĐẶT LƯƠNG & KPI',[
 'CRM Bách Ngân • Dành cho Manager • Bộ KPI chuẩn AppSheet từ kỳ 11/2026.',
 'Bốn vị trí: Sale, Sale Admin, Cửa hàng trưởng và Nhân viên bán hàng cửa hàng. Tài liệu hướng dẫn đúng các chức năng hiện có; những khoản vẫn cần nhập/duyệt thủ công được nêu rõ.',
 'Kỳ số liệu: từ ngày 01 đến ngày cuối tháng. Tổng hợp và chốt: ngày 03–05 tháng sau. Ví dụ kỳ 11/2026 lấy 01–30/11, chốt 03–05/12. Trong ngày 03–05, CRM mặc định gợi ý kỳ tháng trước; luôn kiểm tra ô Chọn tháng.',
 'Mở Bảng lương → chọn đúng tháng → Cài đặt lương nhân viên. Ảnh và mọi con số dưới đây dùng dữ liệu minh họa, không phải bảng lương thật.',
], '01-bang-luong.png','Ảnh 1. Chọn kỳ và mở cài đặt. Khung đỏ đánh dấu các điểm thao tác.'),
('1. Thiết lập chung cho từng nhân viên',[
 'Bước 1: Nhân viên → chọn đúng người → Lương & thưởng → Đặt/Sửa hồ sơ lương. Có thể mở nhanh từ Bảng lương → Cài đặt lương.',
 'Bước 2: Chọn Áp dụng từ tháng. Hồ sơ tiếp tục được dùng đến khi có bản mới; phiếu đã chốt vẫn đọc bản chụp lúc chốt.',
 'Bước 3: Chọn bảng Sale & Văn phòng, NVBH ML (Bách Ngân) hoặc NVBH Lock. Điền LCB, hệ số năng lực, trách nhiệm, phụ cấp, BHXH và tài khoản nhận lương theo chính sách đã duyệt.',
 'Lương theo công = LCB × ngày làm / công chuẩn. Ngày công chấp nhận cả 24.5 và 24,5. Hệ số năng lực × đơn giá hệ số; mức thực tế lấy từ Tham số của kỳ.',
 'Chức vụ trong hồ sơ Nhân viên quyết định điều kiện Sale Admin/NVBH. Cột Vị trí trên hồ sơ lương là nhãn in, không thay chức vụ tài khoản. Nếu đổi chỉ tiêu KPI, nhập lý do rồi lưu.',
], '02-ho-so-chung.png','Ảnh 2. Hồ sơ lương chung: tháng áp dụng, nhóm lương và LCB.'),
('2. Đăng ký doanh số theo năm',[
 'Mở Bảng lương → Đăng ký doanh số năm. Cũng có thể mở từ Hồ sơ lương của nhân viên. Chỉ Manager nhập và điều chỉnh bảng này.',
 'Chọn năm. Mỗi nhân viên có 12 ô từ tháng 1 đến tháng 12; cuộn ngang để xem đủ tháng. Đây là chỉ tiêu kế hoạch, không phải doanh số thực hiện. Chỉ tiêu doanh số KPI cần cùng cơ sở chưa VAT trừ hoa hồng với số thực hiện.',
 'Nhập số tiền nguyên lớn hơn 0, ví dụ 120.000.000 hoặc 120,000,000. Nhập lý do đăng ký/điều chỉnh rồi bấm Lưu đăng ký. Có tổng đăng ký theo người, theo tháng và cả năm.',
 'Chỉ tiêu tháng được đăng ký sẽ tự dùng cho hồ sơ lương, điểm KPI và bảng xếp hạng của đúng tháng đó. Thưởng quý cộng chỉ tiêu ba tháng. Không kế thừa đăng ký sang tháng khác hoặc năm sau.',
 'Ô trống là chưa đăng ký: hệ thống dùng chỉ tiêu hồ sơ cũ hoặc mức chung và ghi rõ nguồn. Xóa số rồi lưu để bỏ đăng ký. Tháng đã chốt lương chỉ xem; bản chụp phiếu đã chốt không đổi.',
 'Ô Chỉ tiêu DS trong hồ sơ lương chỉ đọc. Muốn đổi số, sửa ở bảng năm. Bảng khóa lúc tải năm và báo nếu người khác vừa sửa, tránh lưu nhầm năm hoặc ghi đè.',
], '02b-dang-ky-doanh-so-nam.png','Ảnh 3. Phóng phần đầu bảng năm. Cuộn ngang trên CRM để nhập đủ 12 tháng.'),
('3. Cài đặt cho SALE',[
 'Chọn bảng Sale & Văn phòng. Bật “Sale: tính KPI công việc + thưởng KPI DS”. Chỉ tiêu doanh số tự lấy từ bảng đăng ký năm theo tháng. Điền chỉ tiêu khách mới, giao dịch và số HĐ; ba ô này để trống sẽ theo mức chung.',
 'Muốn tính tự động theo số liệu: để trống KPI cố định và KPI chốt tay. Hai ô này dùng để thay điểm tính toán khi có quyết định riêng; giao diện hiển thị rõ điểm tính và điểm áp dụng.',
 'Bốn phần: KH mới tối đa 10%; giao dịch tối đa 30%; HĐ hợp lệ tối đa 10%; doanh số ghi nhận / chỉ tiêu × 50% và không có trần. Chỉ ngày làm hàng cộng bù 4 KH và 10 giao dịch mỗi ngày; ngày công tác không cộng bù.',
 'Doanh số ghi nhận = doanh số chưa VAT − hoa hồng khách hàng. Nguồn này thống nhất giữa hồ sơ, bảng lương và bảng KPI/xếp hạng. Khi bật tự động, bộ đếm cũ nhập tay không ghi đè nguồn CRM.',
 'Trường hợp được duyệt KPI cố định 100%: nhập 100 ở đúng hồ sơ Sale đã xác minh theo mã nhân viên. Không áp theo tên hiển thị; người trùng tên cần được phân biệt bằng mã.',
], '03-sale.png','Ảnh 4. Bật KPI Sale và ô KPI cố định (%). Cuộn trong hộp thoại để tới phần này.'),
('4. Cài đặt cho SALE ADMIN',[
 'Chọn đúng chức vụ Sale Admin ở Nhân viên và bảng Sale & Văn phòng trong hồ sơ lương.',
 'Sale Admin không tính KPI doanh số của Sale. Bật “Sale Admin: hưởng thưởng sao HĐKT và thanh lý” rồi lưu hồ sơ.',
 'Tại Bảng lương → Cài đặt thưởng HĐKT, kiểm tra tháng bắt đầu, chế độ áp dụng, các mức sao và thưởng thanh lý. Cần bật cả chế độ chung và quyền hưởng của người đó.',
 'Thưởng sao theo giá trị trước VAT của chứng từ đủ điều kiện; thưởng thanh lý phát sinh khi Manager duyệt thanh lý hợp lệ. Căn cứ và khoản đã chốt được theo dõi để tránh tính trùng.',
 'Giới hạn cần biết: hiện người nhận thưởng là người phụ trách chứng từ. Chưa có người Sale Admin hỗ trợ riêng để Sale giữ doanh số còn Admin nhận thưởng hỗ trợ. Không đổi người phụ trách chỉ để chuyển thưởng; quy tắc này cần bổ sung nếu doanh nghiệp dùng cơ chế hỗ trợ.',
], '03-sale-admin.png','Ảnh 5. Sale Admin có nút bật thưởng riêng và không có công tắc tính KPI Sale.'),
('5. Cài đặt cho CỬA HÀNG TRƯỞNG',[
 'Chọn nhóm NVBH ML hoặc NVBH Lock theo cửa hàng. Điền LCB/hệ số và mức trách nhiệm theo chính sách dành cho cửa hàng trưởng.',
 'Trách nhiệm có ba cách: cố định mỗi tháng; theo tỷ lệ ngày làm; hoặc theo ngày với đơn giá chung. Ví dụ ảnh dùng trách nhiệm cố định, không phải mức áp cho toàn bộ nhân viên thật.',
 'Nếu được hưởng doanh số nhóm, bật “NVBH ML / Lock: hưởng thưởng DS của nhóm”. Cập nhật doanh số nhóm và mức chia ở Bảng lương trước khi chốt.',
 'CRM chưa tự tạo phần trăm thưởng quản lý riêng từ chức danh Cửa hàng trưởng/Leader. Đánh dấu trưởng nhóm dùng cho thông tin tổ chức; công thức vẫn theo nhóm lương và hồ sơ.',
 'Số người chia thưởng là tham số cố định, không tự đếm số người bật hưởng. Khi thêm cửa hàng trưởng vào diện nhận, đối chiếu tổng quỹ thưởng và bộ chia trước khi lưu.',
], '03-cua-hang-truong.png','Ảnh 6. Chọn cách tính và mức trách nhiệm dành cho cửa hàng trưởng.'),
('6. Cài đặt cho NVBH CỬA HÀNG',[
 'Chọn đúng chức vụ NVBH ML hoặc NVBH LOCK và nhóm lương tương ứng. Đặt trách nhiệm theo ngày nếu chính sách dùng mức/ngày, cùng chuyên cần, cơm/xăng, BHXH.',
 'Bật hưởng thưởng doanh số nhóm cho người đủ điều kiện. Doanh số ML, trung bình 6 tháng và doanh số Lock được nhập/đối soát trong Số liệu chung của kỳ.',
 'CRM tự áp bậc thưởng ML/Lock theo Tham số rồi chia cho bộ chia đã đặt. Hiện không tự gom doanh số POS riêng cho từng cửa hàng hoặc tự phân quỹ theo số nhân viên.',
 'Chuyên cần hiện là số tiền trong hồ sơ, chưa tự loại theo đi trễ/thiếu công. Nếu không được hưởng trong kỳ, Manager phải điều chỉnh mức theo tháng sau khi đối soát.',
 'Nhân viên thử việc dùng TV/THỬ VIỆC theo chính sách riêng hiện có. Kiểm tra kỹ các khoản ứng/phạt đã ghi và phiếu lương trước khi chốt.',
], '03-nvbh.png','Ảnh 7. Công tắc thưởng doanh số nhóm trong hồ sơ NVBH.'),
('7. Bật chính sách KPI chung',[
 'Vào Bảng lương → Tham số. Chọn tháng áp dụng trước khi lưu để giữ lịch sử các tháng trước.',
 'Từ kỳ 11/2026: Tháng áp dụng KPI chuẩn AppSheet = 202611; Tháng bắt đầu KPI Sale từ CRM = 202611; Áp dụng KPI từ CRM = 1.',
 'Đặt trọng số KH/GD/HĐ/DS lần lượt 10/30/10/50%; mức điểm KH mới khi vượt chỉ tiêu là 10%; bù mỗi ngày làm hàng là 4 KH và 10 GD. Mục số tháng YYYYMM nhập 202611, không nhập 11/2026.',
 'Bậc tiền thưởng doanh số net đang dùng: dưới 60% KPI không thưởng; từ 60% đến dưới 90%: 0,5%; 90% đến hết 120%: 1%; trên 120%: 1,2%. Có thể có cấu hình theo kỳ; không nhầm tỷ lệ thưởng với trọng số điểm KPI.',
 'Ví dụ ảnh: doanh số chưa VAT 100 triệu, hoa hồng 5 triệu → ghi nhận 95 triệu. Chỉ tiêu 100 triệu → phần doanh số 47,5 điểm phần trăm. Tổng KPI trên ảnh là 91,5% sau ba thành phần còn lại.',
], '04-tham-so.png','Ảnh 8. Các công tắc chính sách và nguồn dữ liệu KPI.'),
('8. Thiết lập thưởng HĐKT cho Admin',[
 'Bảng lương → Cài đặt thưởng HĐKT. Chọn tháng bắt đầu và chế độ “Áp dụng vào thực nhận” để cộng tiền; “Đối chiếu” dùng để kiểm tra trước.',
 'Các ngưỡng sao, số tiền theo sao và thưởng thanh lý là tham số công ty. Kiểm tra mức đã được duyệt; những con số trong ảnh chỉ dùng minh họa thao tác.',
 'Kiểm tra người phụ trách, ngày ký/ngày đơn, trạng thái duyệt, giá trị trước VAT và phê duyệt thanh lý. Đơn chờ duyệt/nháp/hủy không được đưa vào doanh số ghi nhận của chính sách KPI mới.',
 'Sau khi đối soát, vào hồ sơ Sale Admin để kiểm tra quyền hưởng đã bật. Việc bật ở một nơi chưa đủ nếu nơi còn lại tắt.',
], '05-thuong-admin.png','Ảnh 9. Màn hình riêng cho chế độ và mức thưởng HĐKT.'),
('9. Kiểm tra KPI và nguồn số liệu',[
 'Tổng quan doanh số → Điểm KPI Sale: chọn tháng và nhân viên. Bốn điểm, tổng điểm và điểm áp dụng lấy cùng kết quả với phiếu lương; xếp hạng theo điểm áp dụng.',
 'KH mới lấy theo khách có đơn CRM được duyệt đầu tiên; giao dịch chăm sóc phải hợp lệ và đã thực hiện; HĐ lấy theo tháng ký và trạng thái đủ điều kiện. Doanh số ghi nhận lấy theo ngày đơn trong kỳ, chưa VAT trừ hoa hồng.',
 'Mỗi người cần được gán đúng trên khách/đơn/HĐ/giao dịch. Mở hồ sơ → Lương & thưởng để đối chiếu các con số và chỉ tiêu trước khi chốt. Đơn thiếu căn cứ hoa hồng sẽ báo và chặn chốt theo chính sách mới.',
 'Nguồn tự động và giới hạn: máy ADMS/SyncTime hiện lưu lượt gốc/gói nhận, chưa tự đổi thành công hoặc giờ tăng ca. Ngày công vẫn cần duyệt hoặc nhập file. Đi trễ/giờ nghỉ chỉ là chỉ số đối chiếu, chưa tự quy đổi tiền phạt.',
], '06-kpi.png','Ảnh 10. Số liệu minh họa: nguồn ghi nhận 95 triệu và tổng KPI 91,5%.'),
('10. Quy trình chốt lương ngày 03–05',[
 '1. Chọn kỳ tháng trước. Kiểm tra dòng “Số liệu … / Chốt lương …” trên đầu bảng; ngày 03–05 là lịch xử lý, không dịch cửa sổ doanh số.',
 '2. Duyệt chấm công hoặc tải file mẫu 11 cột. Nhập ngày công lẻ, tăng ca, bể/đền hàng, số phiếu, trễ, điện thoại, giờ nghỉ, BHXH và ứng. Ô trống file giữ nguyên; 0 ghi bằng 0; Ngày công nhập Tự động để trả về chấm công.',
 '3. Nhập/đối soát doanh số nhóm ML/Lock và số chia thưởng. Kiểm tra phụ cấp, chuyên cần, các khoản trừ đã ghi riêng; khoản nhập nhanh là bổ sung, không xóa khoản riêng.',
 '4. Lưu thay đổi. Đối chiếu Sale/Admin/CHT/NVBH, bốn thành phần KPI, điểm cố định/chốt tay, doanh số ghi nhận và thực nhận. Số liệu thay đổi đồng thời sẽ yêu cầu tải lại, tránh ghi đè.',
 '5. Chốt từng phiếu hoặc cả bảng sau khi kiểm tra. Phiếu lưu bản chụp; sửa hồ sơ/tham số/dữ liệu sau đó không làm đổi phiếu đã chốt. Không tự mở lại phiếu cũ.',
 '6. Xuất Excel bảng lương và chuyển khoản/VietQR, kiểm tra ngân hàng rồi thực hiện trả lương. Nút Chuyển khoản không tự chuyển tiền; chỉ đánh dấu Đã trả sau khi trả thực tế.',
 'Chưa tự động: đổi lượt máy thành công, phân doanh số theo từng cửa hàng, thưởng quản lý riêng cho CHT, thưởng người Admin hỗ trợ và điều kiện chuyên cần/đi trễ. Cần quy tắc nghiệp vụ riêng trước khi bổ sung các phần này.',
], None,None),
]
flow=[]; doc=Document();sec=doc.sections[0];sec.top_margin=Inches(.65);sec.bottom_margin=Inches(.65);sec.left_margin=sec.right_margin=Inches(.7)
normal=doc.styles['Normal'];normal.font.name='Arial';normal.font.size=Pt(10);normal.paragraph_format.space_after=Pt(7)
for idx,(title,texts,image,caption) in enumerate(sections):
 if idx:flow.append(PageBreak());doc.add_page_break()
 flow.append(Paragraph(escape(title),styles['VNTitle']));doc.add_heading(title,0 if idx==0 else 1)
 for text in texts:flow.append(Paragraph(escape(text),styles['VNBody']));doc.add_paragraph(text)
 if image:
  path=IMG/image
  if not path.exists():raise RuntimeError('Missing screenshot '+str(path))
  w,h=PILImage.open(path).size;scale=min(470/w,370/h);flow.append(Spacer(1,5));flow.append(Image(str(path),width=w*scale,height=h*scale));flow.append(Spacer(1,5));flow.append(Paragraph(escape(caption),styles['VNSmall']))
  # Word uses the same capped image dimensions so each illustrated section stays readable.
  doc.add_picture(str(path),width=Inches(w*scale/72),height=Inches(h*scale/72));doc.add_paragraph(caption,style='Caption')
def footer(canvas,document):
 canvas.setFont('VN',8);canvas.setFillColor(colors.HexColor('#53647b'));canvas.drawString(42,25,'CRM Bách Ngân • Hướng dẫn cài đặt lương • Ảnh dữ liệu minh họa');canvas.drawRightString(A4[0]-42,25,str(document.page))
pdf=OUT/'huong-dan-cai-dat-luong.pdf';SimpleDocTemplate(str(pdf),pagesize=A4,leftMargin=42,rightMargin=42,topMargin=35,bottomMargin=42,title='Hướng dẫn cài đặt lương & KPI CRM Bách Ngân',author='CRM Bách Ngân').build(flow,onFirstPage=footer,onLaterPages=footer)
word=OUT/'huong-dan-cai-dat-luong.docx';doc.save(word)
print(pdf);print(word)
