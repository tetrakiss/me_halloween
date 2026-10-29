# Bunker artwork

Generated with the built-in imagegen tool for this project.

Final room prompt:
Landscape 16:9 game background. Cheerful retrofuturist 1950s atomic-age underground bunker interior, Fallout-inspired optimistic mid-century Americana, painterly high quality game environment. Warm golden light, turquoise and cream enamel equipment, bright friendly red accents, cozy lived-in radio desk left with green CRT and coffee mug, pipes and round ventilation grille right. Central back wall: a perfectly front-facing rectangular OPEN doorway, black empty inside, thick steel frame, NO door leaf because animated door will be overlaid by game. Small party bunting overhead, playful optimistic mood, clean readable composition, atmospheric but NOT scary or gloomy. No people no text no logos no UI. Full bleed artwork.

Final door prompt:
Single isolated front-facing rectangular heavy sliding vault door leaf for a cheerful 1950s atomic-age retrofuturist bunker game. Tall rectangle aspect ratio 0.91 width to height. Turquoise weathered enamel steel, thick cream metal rim, cream circular locking wheel in lower middle, small cream placard with number 07 near top, yellow and teal diagonal stripe along bottom, charming mid century industrial aesthetic, warm golden light from upper left, realistic painted game asset, no surrounding room, no floor, no cast shadow outside object. Door fills frame with minimal margin. Transparent background. No other objects.

Assets: room.png, door.png. The doorway overlay follows the actual generated opening. The moving leaf is clipped inside the illustrated frame.

## Realistic door revision (1.0.56)

Built-in imagegen; saved as `door-realistic.png`.

Prompt: One single solid rectangular sliding bunker door leaf, almost square slightly taller, front orthographic view, parallel edges and minimal corner rounding. Realistic thick aged turquoise enamel steel with cream reinforcements, chipped paint, bolts, welded seams and believable depth. Fallout-like 1950s retrofuturism, warm golden light from upper left. Recessed central circular locking assembly, no projecting wheel (animated separately). No outer frame, hinges, room, labels or text. Transparent background, fills canvas with no margins.

The scene uses uniform cover scaling with edge cropping. The door uses cover sizing and the lock uses a square aspect ratio, preserving circular geometry on all displays.

## Corridor and visitors (1.0.57)

Generated with built-in imagegen. Final assets are `corridor.png`, `robot-coffee.png`, and `resident-wave.png` in this directory. An unused resident draft remains outside the project and is not referenced.

Corridor prompt:
Use case stylized-concept. Game environment background seen through an open bunker doorway, portrait nearly square 940 wide by 1000 high composition. Cheerful realistic painted retrofuturist 1950s atomic-age underground corridor, Fallout-inspired. Camera eye-level looking down a deep corridor, central vanishing point. Warm amber ceiling lamps, cream upper walls, turquoise lower enamel wall panels, red utility pipes overhead, polished worn concrete floor, rounded bulkhead arches receding in distance, a potted plant by a distant side door. Foreground floor spacious and clear for separately animated characters walking sideways. Golden warm illumination from upper left, believable tactile metal and soft shadows, inviting lived-in mood. No people no robots no text no UI no foreground door or frame. Full bleed artwork.

Robot prompt:
Use case stylized-concept. Single isolated full body friendly retrofuturist 1950s service robot, realistic painted game sprite matching a warm golden lit turquoise and cream atomic-age bunker. Robot has cream enamel round body, turquoise panels, two small warm amber eyes, articulated brass arms, one hand carrying a small tray with a steaming coffee mug, rolling on two small wheels. Three-quarter view facing to the right, traveling sideways across a corridor. Warm light from upper left, believable chipped metal, cheerful restrained expression. Entire robot and tray visible, transparent background, no floor no scene no text no logo, minimal margins.

Resident prompt:
Use case stylized-concept. Single isolated full body friendly adult female bunker resident, realistic painted retrofuturist 1950s atomic-age game character. Turquoise work jumpsuit with cream collar and golden belt, brown practical boots, short curled auburn hairstyle, warm relaxed smile. Three-quarter frontal pose, entire body visible. LEFT arm (viewer right side) raised in greeting, elbow pointing outward and open hand beside her head, isolated from torso with transparent gap so this arm can be animated as separate layer. Other arm relaxed by side. Believable human anatomy, both arms and hands fully present, warm golden light from upper left, realistic textured illustration matching a cozy Fallout-inspired bunker. Transparent background no floor no scene no text no logo no cast shadow outside body. Minimal margins.

Visitors are clipped inside the portal behind the moving door. The first cycle shows the robot. Later cycles randomly show a robot, a waving resident, or an empty corridor. The resident arm is animated from the same image using complementary CSS clips; all art keeps its original proportions.
