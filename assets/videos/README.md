### Recording
```
wf-recorder -f alt.mp4
```

### Crop and convert to .gif with ffmpeg
```
ffmpeg -ss 1.2 -t 19.5 -i alt.mp4 -vf "crop=1100:619:0:0" -r 15 alt.gif
```
Change 619 => 630 or something for the next one. The current one is missing bototm padding at the end of the video
