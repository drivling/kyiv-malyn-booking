import { Config } from '@remotion/cli/config';

// Кадри для кодека — JPEG високої якості (інтерфейс із дрібним текстом), відео — H.264 yuv420p, як хоче Meta
Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(95);
Config.setCodec('h264');
Config.setPixelFormat('yuv420p');
Config.setCrf(16);
Config.setOverwriteOutput(true);
