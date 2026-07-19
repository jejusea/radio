#!/usr/bin/env bash
# ============================================================
# placeholder 미디어 생성 스크립트 (개발용)
#
# 실제 작품 파일이 준비되기 전, 앱 동작 확인용 미디어를 생성한다.
# 실행에는 ffmpeg가 필요하다. (개발 단계에서만 필요 — 앱 실행에는 불필요)
#
#   bash tools/generate-placeholders.sh
#
# 생성물:
#   media/videos/video_001.webm ... video_010.webm  (1024x600, 6~10초)
#   media/radio/radio_001.mp3  ... radio_005.mp3    (약 60초)
#   media/effects/tuning_01.mp3 ... tuning_03.mp3   (약 0.7초)
#
# placeholder 영상은 모든 Chromium 계열에서 재생되도록 WebM(VP9)로 만든다.
# 실제 전시 파일은 H.264 MP4를 그대로 넣으면 된다 (manifest의 file 값만 맞추면 됨).
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

FONT="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

# ---------- 영상 10개 ----------
# 서로 다른 색·길이·오디오 톤을 가진 장면. 화면에 SCENE 번호를 크게 표시.
COLORS=(0x2b3a4a 0x4a3a2b 0x3a4a2b 0x4a2b3a 0x2b4a44 0x44402b 0x3a2b4a 0x2b2b3a 0x4a442b 0x35424a)
DURS=(8 6 9 7 10 6 8 7 9 8)
FREQS=(220 262 294 330 349 392 440 494 523 587)

for i in $(seq 0 9); do
  n=$(printf "%03d" $((i+1)))
  echo "video_${n}.webm ..."
  ffmpeg -y -loglevel error \
    -f lavfi -i "gradients=s=1024x600:d=${DURS[$i]}:r=24:speed=0.015:c0=${COLORS[$i]}:c1=0x0a0a0f" \
    -f lavfi -i "sine=frequency=${FREQS[$i]}:duration=${DURS[$i]}" \
    -filter_complex "\
      [0:v]drawtext=fontfile=${FONT}:text='SCENE $((i+1))':fontsize=110:fontcolor=white@0.85:x=(w-text_w)/2:y=(h-text_h)/2-30,\
           drawtext=fontfile=${FONT}:text='placeholder video ${n}':fontsize=28:fontcolor=white@0.5:x=(w-text_w)/2:y=(h)/2+80[v];\
      [1:a]tremolo=f=4:d=0.4,volume=0.25,afade=t=in:d=0.3,afade=t=out:st=$((DURS[$i]-1)):d=0.9[a]" \
    -map "[v]" -map "[a]" \
    -c:v libvpx-vp9 -b:v 300k -c:a libopus -b:a 48k \
    "media/videos/video_${n}.webm"
done

# ---------- 라디오 5개 ----------
# 방송국마다 다른 톤 패턴 + 노이즈로 구분되는 약 60초 음원.
RFREQS=(392 494 587 330 262)
RBEATS=(1.0 1.7 0.7 2.3 1.3)
for i in $(seq 0 4); do
  n=$(printf "%03d" $((i+1)))
  echo "radio_${n}.mp3 ..."
  ffmpeg -y -loglevel error \
    -f lavfi -i "sine=frequency=${RFREQS[$i]}:duration=60" \
    -f lavfi -i "anoisesrc=color=pink:duration=60:amplitude=0.08" \
    -filter_complex "\
      [0:a]tremolo=f=${RBEATS[$i]}:d=0.9,volume=0.22[t];\
      [t][1:a]amix=inputs=2:duration=first,lowpass=f=3400,highpass=f=250,volume=1.4[a]" \
    -map "[a]" -c:a libmp3lame -b:a 64k -ac 1 \
    "media/radio/radio_${n}.mp3"
done

# ---------- 튜닝 효과 3개 ----------
for i in 1 2 3; do
  echo "tuning_0${i}.mp3 ..."
  ffmpeg -y -loglevel error \
    -f lavfi -i "anoisesrc=color=white:duration=0.7:amplitude=0.5" \
    -af "highpass=f=$((400*i)),lowpass=f=$((2500+i*800)),tremolo=f=$((10+i*7)):d=0.7,afade=t=in:d=0.05,afade=t=out:st=0.55:d=0.15,volume=0.8" \
    -c:a libmp3lame -b:a 64k -ac 1 \
    "media/effects/tuning_0${i}.mp3"
done

echo "done."
