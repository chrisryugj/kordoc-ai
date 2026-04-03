import sys
from PIL import Image
from rembg import remove
import io

def process_icon(input_path, output_path):
    print(f"이미지 처리 중: {input_path}")
    
    # 1. 이미지 불러오기
    with open(input_path, 'rb') as i:
        input_data = i.read()
    
    # 2. 배경 제거 (투명하게)
    print("배경을 제거하는 중...")
    output_data = remove(input_data)
    img = Image.open(io.BytesIO(output_data)).convert("RGBA")
    
    # 3. 빈틈없이 자르기 (Bounding Box)
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)
        
    # 4. 비율을 유지하며 여백 추가 (정사각형 만들기)
    width, height = img.size
    max_dim = max(width, height)
    
    square_img = Image.new("RGBA", (max_dim, max_dim), (0, 0, 0, 0))
    paste_x = (max_dim - width) // 2
    paste_y = (max_dim - height) // 2
    square_img.paste(img, (paste_x, paste_y))
    
    # 5. 512x512 사이즈로 꽉 차게 리사이즈
    print("512x512 사이즈로 리사이즈 중...")
    final_img = square_img.resize((512, 512), Image.Resampling.LANCZOS)
    
    # 결과 저장
    final_img.save(output_path, format="PNG")
    print(f"작업 완료! 결과 파일이 저장되었습니다: {output_path}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("사용법: python process_icon.py <원본_이미지_경로> <결과_이미지_경로>")
    else:
        process_icon(sys.argv[1], sys.argv[2])
