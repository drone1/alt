### Recording
```
wf-recorder -f alt.mp4
```

### Crop and convert to .gif with ffmpeg
```
ffmpeg -ss <start time> -t <duration> -i alt.mp4 -vf "crop=<new width>:<new height>:<x>:<y>" -r 15 alt.gif
```
`-r` specifies the fps

