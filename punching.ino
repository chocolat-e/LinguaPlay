#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#define MPU_ADDR 0x68

#define SDA_PIN 21
#define SCL_PIN 22

#define BUTTON_PIN 27

#define LED_G 26
#define LED_R 25
#define LED_B 33

#define JOY_X 34
#define JOY_Y 35

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

int joyX = 0;
int joyY = 0;
int buttonState = HIGH;

String action = "READY";
String joyDir = "CENTER";

unsigned long lastPunchTime = 0;
unsigned long lastDisplayTime = 0;
unsigned long lastShownTime = 0;

const int punchCooldown = 350;
const int showDuration = 800;

const float punchThreshold = 1.5;

void writeMPU(byte reg, byte data) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(data);
  Wire.endTransmission();
}

void setLED(bool r, bool g, bool b) {
  digitalWrite(LED_R, r ? HIGH : LOW);
  digitalWrite(LED_G, g ? HIGH : LOW);
  digitalWrite(LED_B, b ? HIGH : LOW);
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

  ax = accX / 4096.0;
  ay = accY / 4096.0;
  az = accZ / 4096.0;

  gx = gyroX / 131.0;
  gy = gyroY / 131.0;
  gz = gyroZ / 131.0;
}

void readInputs() {
  joyX = analogRead(JOY_X);
  joyY = analogRead(JOY_Y);
  buttonState = digitalRead(BUTTON_PIN);

  if (joyX < 1200) {
    joyDir = "LEFT";
  } else if (joyX > 2800) {
    joyDir = "RIGHT";
  } else if (joyY < 1200) {
    joyDir = "UP";
  } else if (joyY > 2800) {
    joyDir = "DOWN";
  } else {
    joyDir = "CENTER";
  }
}

void updateAction() {
  unsigned long now = millis();

  action = "READY";

  accPower = sqrt(ax * ax + ay * ay + az * az);
  punchPower = abs(accPower - 1.0);

  if (punchPower > punchThreshold && now - lastPunchTime > punchCooldown) {
    action = "PUNCH";
    lastPunchTime = now;
    lastShownTime = now;
  }

  if (buttonState == LOW) {
    action = "BUTTON";
    lastShownTime = now;
  }

  if (now - lastShownTime < showDuration) {
    if (buttonState == LOW) {
      action = "BUTTON";
    } else if (punchPower > punchThreshold) {
      action = "PUNCH";
    }
  }

  if (action == "PUNCH") {
    setLED(false, true, false);
  } else if (action == "BUTTON") {
    setLED(false, false, true);
  } else {
    setLED(true, false, false);
  }
}

void printSerial() {
  Serial.print("{");

  Serial.print("\"action\":\"");
  Serial.print(action);
  Serial.print("\",");

  Serial.print("\"joy\":\"");
  Serial.print(joyDir);
  Serial.print("\",");

  Serial.print("\"button\":");
  Serial.print(buttonState == LOW ? 1 : 0);
  Serial.print(",");

  Serial.print("\"x\":");
  Serial.print(joyX);
  Serial.print(",");

  Serial.print("\"y\":");
  Serial.print(joyY);
  Serial.print(",");

  Serial.print("\"punchPower\":");
  Serial.print(punchPower, 2);
  Serial.print(",");

  Serial.print("\"accPower\":");
  Serial.print(accPower, 2);

  Serial.println("}");
}

void updateOLED() {
  if (millis() - lastDisplayTime < 80) return;
  lastDisplayTime = millis();

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("ESP32 Game Remote");
  display.drawLine(0, 11, 127, 11, SSD1306_WHITE);

  display.setTextSize(2);
  display.setCursor(0, 17);
  display.println(action);

  display.setTextSize(1);
  display.setCursor(0, 40);
  display.print("Joy:");
  display.print(joyDir);

  display.setCursor(0, 50);
  display.print("X:");
  display.print(joyX);

  display.setCursor(64, 50);
  display.print("Y:");
  display.print(joyY);

  display.setCursor(0, 60);
  display.print("P:");
  display.print(punchPower, 2);

  display.display();
}

void setup() {
  Serial.begin(115200);

  pinMode(BUTTON_PIN, INPUT_PULLUP);

  pinMode(LED_R, OUTPUT);
  pinMode(LED_G, OUTPUT);
  pinMode(LED_B, OUTPUT);

  setLED(true, false, false);

  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(400000);

  writeMPU(0x6B, 0x00);
  delay(100);

  writeMPU(0x1A, 0x03);
  writeMPU(0x1B, 0x00);
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
  display.println("Game Remote Ready");
  display.println("Punch + Button + Joy");
  display.display();

  Serial.println("ESP32 Game Remote Ready");
  delay(500);
}

void loop() {
  readMPU();
  readInputs();
  updateAction();
  printSerial();
  updateOLED();

  delay(20);
}
