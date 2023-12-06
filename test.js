const { createCanvas, loadImage } = require("canvas");
const fs = require("node:fs");
const test = require("flug");
const GeoTIFF = require("geotiff");
const get_epsg_code = require("geotiff-epsg-code");
const get_geotiff_no_data = require("geotiff-no-data");
const geowarp = require("geowarp");
const proj4 = require("proj4-fully-loaded");
const reproject_bounding_box = require("reproject-bbox");
const writeImage = require("write-image");

const geowarp_canvas = require("./index");

const paint = geowarp_canvas(geowarp);

const saveCanvas = (filepath, canvas) => {
  const context = canvas.getContext("2d");
  const { data, height, width } = context.getImageData(
    0,
    0,
    canvas.width,
    canvas.height
  );
  const { data: buf } = writeImage({ data, height, format: "PNG", width });
  fs.writeFileSync(filepath, buf);
};

const filenames = [
  // "abetow-ERD2018-EBIRD_SCIENCE-20191109-a5cf4cb2_hr_2018_abundance_median.tiff",
  "eu_pasture.tiff",
  "GA4886_VanderfordGlacier_2022_EGM2008_64m-epsg3031.cog",
  "gadas.tif",
  "GeogToWGS84GeoKey5.tif",
  "lcv_landuse.cropland_hyde_p_10km_s0..0cm_2016_v3.2.tif",
  "nt_20201024_f18_nrt_s.tif",
  "utm.tif",
  "vestfold.tif",
  "wildfires.tiff",
  "wind_direction.tif"
];

const methods = ["near", "vectorize", "bilinear", "median"];

const resolutions = [
  [1, 1],
  [0.25, 0.25],
  [0.99, 0.99],
  [0.9, 0.9],
  [0.5, 0.5],
  [0.333, 0.333],
  [0.1, 0.1]
];

(async () => {
  for (let f = 0; f < filenames.length; f++) {
    const filename = filenames[f];
    const geotiff = await GeoTIFF.fromFile("./test-data/" + filename);
    const image = await geotiff.getImage();
    const in_data = await image.readRasters();

    const in_bbox = image.getBoundingBox();
    const in_height = image.getHeight();
    // files doesn't include no data value
    const in_no_data =
      filename === "wind_direction.tif" ? -32767 : get_geotiff_no_data(image);
    let in_srs = await get_epsg_code(geotiff);
    if (in_srs === 32767 || in_srs === null) in_srs = undefined;

    const out_srs = in_srs === undefined ? undefined : 4326;

    const in_width = image.getWidth();

    const out_bbox =
      in_srs === out_srs
        ? in_bbox
        : reproject_bounding_box({ bbox: in_bbox, from: in_srs, to: out_srs });
    const { forward, inverse } =
      in_srs === out_srs ? {} : proj4("EPSG:" + in_srs, "EPSG:" + out_srs);

    const ratio = in_height / in_width;

    const out_width = 512;
    const out_height = Math.round(ratio * out_width);

    methods.forEach(method => {
      resolutions.forEach(out_resolution => {
        const test_name =
          "rescale-" + filename + "-" + method + "-" + out_resolution.join("-");
        test(test_name, async ({ eq }) => {
          console.log("starting " + test_name);
          console.log("loaded");

          const out_canvas = createCanvas(out_width, out_height);

          // console.log({in_no_data})
          paint({
            plugins: ["canvas"],
            out_canvas,
            out_no_data_color: "pink",
            out_resolution,

            debug_level: Number(process.env.DEBUG_LEVEL || 0),
            forward,
            inverse,

            in_bbox,
            in_data,
            in_height,
            in_layout: "[band][row,column]",
            in_no_data,
            in_srs,
            in_width,
            out_bbox,
            out_srs,
            method
          });

          saveCanvas("./test-output/" + test_name + ".png", out_canvas);
        });
      });
    });
  }

  const wind_direction = await GeoTIFF.fromFile(
    "./test-data/wind_direction.tif"
  );
  const wind_direction_image = await wind_direction.getImage();
  const wind_direction_data = await wind_direction_image.readRasters();
  [
    [0.1, 0.1],
    [0.05, 0.05],
    [0.01, 0.01]
  ].forEach(out_resolution => {
    methods.forEach(method => {
      const test_name = `arrows-${method}-${out_resolution}`;
      test(test_name, async ({ eq }) => {
        const in_bbox = wind_direction_image.getBoundingBox();
        const in_height = wind_direction_image.getHeight();
        // files doesn't include no data value
        const in_no_data = -32767;
        const in_width = wind_direction_image.getWidth();
        const in_srs = await get_epsg_code(wind_direction);

        let out_srs, out_bbox, forward, inverse;
        if (in_srs) {
          out_srs = 4326;
          out_bbox =
            in_srs === out_srs
              ? in_bbox
              : reproject_bounding_box({
                  bbox: in_bbox,
                  from: in_srs,
                  to: out_srs
                });
          ({ forward, inverse } = proj4("EPSG:" + in_srs, "EPSG:" + out_srs));
        } else {
          out_srs = "simple";
          in_srs = "simple";
        }

        const ratio = in_height / in_width;

        const out_width = 512;
        const out_height = Math.round(ratio * out_width);

        const out_canvas = createCanvas(out_width, out_height);

        paint({
          plugins: ["canvas"],
          out_canvas,
          out_no_data_color: "pink",
          out_resolution,
          after_draw: ({
            bbox: [xmin, ymin, xmax, ymax],
            context: ctx,
            pixel,
            rect,
            scale: [width, height]
          }) => {
            ctx.save();

            // outline pixel with rectange
            ctx.strokeStyle = "chartreuse";
            ctx.strokeRect(...rect);

            // console.log({context, pixel, raw, row: x, column: y, resolution: [width, height]})
            const value = pixel[0];
            const arrowSize = Math.min(width, height) / 2.5;
            // console.log({ value, width, arrowSize })
            ctx.translate((xmax + xmin) / 2, (ymin + ymax) / 2);
            ctx.rotate(((90 + value) * Math.PI) / 180);
            ctx.beginPath();
            ctx.moveTo(-arrowSize / 2, 0);
            ctx.lineTo(+arrowSize / 2, 0);
            ctx.moveTo(arrowSize * 0.25, -arrowSize * 0.25);
            ctx.lineTo(+arrowSize / 2, 0);
            ctx.lineTo(arrowSize * 0.25, arrowSize * 0.25);
            ctx.stroke();

            ctx.restore();
          },

          debug_level: 0,
          forward,
          inverse,

          in_bbox,
          in_data: wind_direction_data,
          in_height,
          in_layout: "[band][row,column]",
          in_no_data,
          in_srs,
          in_width,
          out_bbox,
          out_srs,
          method
        });

        saveCanvas(`./test-output/${test_name}.png`, out_canvas);
      });
    });
  });
})();
