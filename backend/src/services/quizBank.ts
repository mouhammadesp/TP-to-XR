import type { QuizTarget } from "./quiz";

const target = (answer: string, ...variants: [string, string][]): QuizTarget => ({
  answer,
  variants: variants.map(([id, prompt]) => ({ id, prompt })),
});

/**
 * Audi A3 8P engine bay: only the nine zones embedded in audi_tfsi_engine.glb.
 * Questions about the battery, washer and brake fluid explicitly concern the
 * engine BAY, not the engine itself. There is no invented coolant-cap zone.
 */
export const ENGINE_QUESTION_BANK: readonly QuizTarget[] = [
  target("oil_cap",
    ["oil_cap_location", "Quel bouchon faut-il ouvrir pour ajouter de l'huile moteur ? Sélectionnez-le."],
    ["oil_cap_lubrication", "Repérez l'orifice par lequel on fait l'appoint d'huile de lubrification du moteur."]
  ),
  target("dipstick",
    ["dipstick_level", "Quel composant permet de contrôler le niveau d'huile moteur entre les repères mini et maxi ?"],
    ["dipstick_location", "Repérez la tige avec une poignée qui sert à mesurer le niveau d'huile du moteur."]
  ),
  target("coolant_tank",
    ["coolant_tank_location", "Où se trouve le vase d'expansion du liquide de refroidissement ? Sélectionnez le réservoir, pas son bouchon."],
    ["coolant_tank_role", "Quel réservoir contient la réserve de liquide de refroidissement et accompagne ses variations de volume dans le circuit ?"]
  ),
  target("air_filter",
    ["air_filter_location", "Quel boîtier contient le filtre qui retient les poussières avant l'admission d'air dans le moteur ?"],
    ["air_filter_role", "Repérez le boîtier du filtre à air du circuit d'admission."]
  ),
  target("battery",
    ["battery_location", "Dans le compartiment moteur, quel équipement électrique alimente notamment le démarreur ?"],
    ["battery_role", "Repérez la batterie du véhicule, qui fournit du courant lorsque le moteur est arrêté."]
  ),
  target("engine_cover",
    ["engine_cover_location", "Quel capot plastique protège le dessus du moteur et atténue son bruit ?"],
    ["engine_cover_tfsi", "Repérez le cache moteur marqué TFSI, sans le confondre avec une pièce interne du moteur."]
  ),
  target("intake_duct",
    ["intake_duct_location", "Quel conduit achemine l'air filtré vers le système d'admission du moteur ?"],
    ["intake_duct_role", "Repérez le tuyau d'admission qui relie le boîtier de filtre à air au moteur."]
  ),
  target("washer_cap",
    ["washer_cap_location", "Quel bouchon donne accès au réservoir de liquide lave-glace, situé dans le compartiment moteur ?"],
    ["washer_cap_role", "Repérez l'orifice de remplissage du liquide destiné à nettoyer le pare-brise."]
  ),
  target("brake_fluid",
    ["brake_fluid_location", "Quel petit réservoir contient le liquide du système de freinage ? Il se trouve dans le compartiment, mais hors du moteur."],
    ["brake_fluid_role", "Repérez le réservoir de liquide de frein, sans le confondre avec celui du liquide de refroidissement."]
  ),
];

/** Five real instruments on the workbench; no absent equipment is questioned. */
export const INSTRUMENT_QUESTION_BANK: readonly QuizTarget[] = [
  target("i_oscilloscope",
    ["oscilloscope_identification", "Quel instrument affiche la forme d'un signal électrique et son évolution dans le temps ?"],
    ["oscilloscope_measurement", "Vous voulez observer une tension variable et mesurer ses variations temporelles. Quel appareil choisissez-vous ?"],
    ["oscilloscope_situation", "Un signal semble déformé. Quel équipement permet d'en visualiser la forme d'onde pour analyser le problème ?"]
  ),
  target("i_alim_dc",
    ["dc_supply_identification", "Quel équipement fournit une tension continue réglable et stabilisée à un montage ?"],
    ["dc_supply_situation", "Vous devez alimenter un circuit électronique sous 5 V continu. Quel appareil utilisez-vous ?"],
    ["dc_supply_function", "Quel boîtier faut-il régler pour obtenir une source de tension continue de 12 V ?"]
  ),
  target("i_station_soudage",
    ["soldering_identification", "Quel équipement utilise un fer chauffant pour réaliser un assemblage à l'étain ?"],
    ["soldering_situation", "Vous devez fixer durablement un composant sur un circuit imprimé par brasage. Quel poste choisissez-vous ?"],
    ["soldering_function", "Quel appareil permet de faire fondre l'étain pour souder deux éléments électroniques ?"]
  ),
  target("i_multimetre_ana",
    ["analog_meter_identification", "Quel multimètre affiche la mesure par une aiguille sur une échelle graduée ?"],
    ["analog_meter_measurement", "Vous voulez lire une tension sur un cadran à aiguille. Quel instrument utilisez-vous ?"],
    ["analog_meter_situation", "Quel appareil analogique permet de vérifier une résistance hors tension avec une lecture par aiguille ?"]
  ),
  target("i_multimetre_num",
    ["digital_meter_identification", "Quel instrument affiche numériquement une tension, un courant ou une résistance selon son mode ?"],
    ["digital_meter_voltage", "Vous voulez vérifier la tension aux bornes d'une pile avec une valeur affichée en chiffres. Quel appareil choisissez-vous ?"],
    ["digital_meter_resistance", "Quel multimètre numérique utilisez-vous pour mesurer la valeur d'une résistance isolée et hors tension ?"]
  ),
];
