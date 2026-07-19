#!/usr/bin/env bash
# ============================================================
# 사진 → 영상 클립 변환 (개발용, ffmpeg 필요)
#
#   bash tools/images-to-clips.sh [클립 길이(초), 기본 8]
#
# media/images/ 안의 사진(jpg/png/webp)을 640×480(4:3) 무음 클립으로
# 변환해 media/videos/photo_XXX.webm 으로 저장한다.
# 비율이 4:3이 아닌 사진은 잘리지 않고 검은 여백(pad)으로 맞춘다.
# 변환 후 data/videos.json에 등록해야 재생된다 (node tools/scan-media.mjs 참고).
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

DUR="${1:-8}"
mkdir -p media/images media/videos

shopt -s nullglob nocaseglob
files=(media/images/*.{jpg,jpeg,png,webp})
if [ ${#files[@]} -eq 0 ]; then
  echo "media/images/ 에 사진이 없습니다. 사진을 넣고 다시 실행하세요."
  exit 1
fi

i=0
for img in "${files[@]}"; do
  i=$((i+1))
  n=$(printf "%03d" "$i")
  out="media/videos/photo_${n}.webm"
  echo "$img → $out (${DUR}s)"
  ffmpeg -y -loglevel error \
    -loop 1 -i "$img" \
    -f lavfi -i "anullsrc=r=48000:cl=mono" \
    -t "$DUR" \
    -vf "scale=640:480:force_original_aspect_ratio=decrease,pad=640:480:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p" \
    -r 24 -c:v libvpx-vp9 -b:v 400k -c:a libopus -b:a 32k -shortest \
    "$out"
done

echo ""
echo "${i}개 변환 완료. data/videos.json 예시:"
echo "["
for j in $(seq 1 $i); do
  n=$(printf "%03d" "$j")
  comma=$([ "$j" -lt "$i" ] && echo "," || echo "")
  echo "  { \"id\": \"p${n}\", \"file\": \"photo_${n}.webm\", \"label\": \"photo ${n}\" }${comma}"
done
echo "]"
