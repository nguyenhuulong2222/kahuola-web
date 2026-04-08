import requests
import os

# Tọa độ khu vực Hawaii (Maui)
AREA = "-160,18,-154,23"
URL = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/c7774e30472480371661604077717462/MODIS_NRT/{AREA}/1"

def update_kahuola_data():
    path = os.path.expanduser("~/Documents/KahuOla_AI_Ready/maui_live_fire.csv")
    
    # Tự động tạo thư mục nếu chưa có
    os.makedirs(os.path.dirname(path), exist_ok=True)
    
    try:
        response = requests.get(URL)
        if response.status_code == 200:
            with open(path, "w") as f:
                f.write(response.text)
            print("🔥 Kahu Ola: Đã cập nhật dữ liệu vệ tinh NASA mới nhất!")
        else:
            print(f"❌ Lỗi kết nối NASA: {response.status_code}")
    except Exception as e:
        print(f"❌ Lỗi hệ thống: {e}")

if __name__ == "__main__":
    update_kahuola_data()
