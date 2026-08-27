#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#define MPU_ADDR 0x68

#define SDA_PIN 21
#define SCL_PIN 22

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1
#define OLED_ADDR 0x3C

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

int16_t accX, accY, accZ;
int16_t gyroX, gyroY, gyroZ;

float ax, ay, az;
float gx, gy, gz;

float accPower = 0;
float punchPower = 0;

String action = "READY";

unsigned long lastPunchTime = 0;
unsigned long lastDisplayTime = 0;
unsigned long lastShownTime = 0;

const int punchCooldown = 350;
const int showDuration = 800;

// Neu qua nhay, tang len 1.8 hoac 2.0
// Neu kho nhan, giam xuong 1.2 hoac 1.0
const float punchThreshold = 1.5;

void writeMPU(byte reg, byte data) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(data);
  Wire.endTransmission();
}

void readMPU() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);
  Wire.endTransmission(false);
  Wire.requestFrom(MPU_ADDR, 14, true);

  accX = Wire.read() << 8 | Wire.read();
  accY = Wire.read() << 8 | Wire.read();
  accZ = Wire.read() << 8 | Wire.read();

  Wire.read();
  Wire.read();

  gyroX = Wire.read() << 8 | Wire.read();
  gyroY = Wire.read() << 8 | Wire.read();
  gyroZ = Wire.read() << 8 | Wire.read();

  // Accel range +-8g => 4096 LSB/g
  ax = accX / 4096.0;
  ay = accY / 4096.0;
  az = accZ / 4096.0;

  gx = gyroX / 131.0;
  gy = gyroY / 131.0;
  gz = gyroZ / 131.0;
}

void updatePunch() {
  unsigned long now = millis();

  action = "NONE";

  accPower = sqrt(ax * ax + ay * ay + az * az);

  // Tru di 1g vi luc hut trai dat luc dung yen
  punchPower = abs(accPower - 1.0);

  if (punchPower > punchThreshold && now - lastPunchTime > punchCooldown) {
    action = "PUNCH";
    lastPunchTime = now;
    lastShownTime = now;
  }

  if (now - lastShownTime < showDuration) {
    action = "PUNCH";
  } else {
    action = "READY";
  }
}

void printSerial() {
  Serial.print("{");

  Serial.print("\"action\":\"");
  Serial.print(action);
  Serial.print("\",");

  Serial.print("\"ax\":");
  Serial.print(ax, 2);
  Serial.print(",");

  Serial.print("\"ay\":");
  Serial.print(ay, 2);
  Serial.print(",");

  Serial.print("\"az\":");
  Serial.print(az, 2);
  Serial.print(",");

  Serial.print("\"accPower\":");
  Serial.print(accPower, 2);
  Serial.print(",");

  Serial.print("\"punchPower\":");
  Serial.print(punchPower, 2);

  Serial.println("}");
}

void updateOLED() {
  if (millis() - lastDisplayTime < 80) return;
  lastDisplayTime = millis();

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("Punch Detector");
  display.drawLine(0, 11, 127, 11, SSD1306_WHITE);

  display.setTextSize(2);
  display.setCursor(0, 20);
  display.println(action);

  display.setTextSize(1);
  display.setCursor(0, 48);
  display.print("Power:");
  display.print(punchPower, 2);

  display.setCursor(0, 58);
  display.print("Acc:");
  display.print(accPower, 2);
  display.print("g");

  display.display();
}

void setup() {
  Serial.begin(115200);

  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(400000);

  writeMPU(0x6B, 0x00);
  delay(100);

  // Low pass filter
  writeMPU(0x1A, 0x03);

  // Gyro range +-250 deg/s
  writeMPU(0x1B, 0x00);

  // Accel range +-8g
  writeMPU(0x1C, 0x10);

  delay(300);

  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    Serial.println("OLED not found");
    while (true);
  }

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("MPU6050 Ready");
  display.println("Punch mode");
  display.display();

  Serial.println("MPU6050 Ready");
  delay(500);
}

void loop() {
  readMPU();
  updatePunch();
  printSerial();
  updateOLED();

  delay(20);
}